import { isPermission } from '@emis/permissions';
import { RequestMethod } from '@nestjs/common';
import { ModulesContainer, Reflector } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { IS_PUBLIC } from '../../modules/identity/index.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { REQUIRED_PERMISSION, SELF_SERVICE } from './decorators.js';

// @nestjs/throttler stores a route's own limit under this key.
const THROTTLER_LIMIT_DEFAULT = 'THROTTLER:LIMITdefault';

// Nest stores the route path/method under these metadata keys on each handler.
const PATH_METADATA = 'path';
const METHOD_METADATA = 'method';

interface RouteRule {
  /** "POST /public/pre-registrations": the HTTP method and path, without the /api/v1 prefix. */
  endpoint: string;
  method: string;
  /** The route sets its own rate limit (not just the app-wide default). */
  throttled: boolean;
  route: string;
  rules: string[];
  permission?: string;
}

/** Every HTTP route the app exposes, with the access rules it declares. */
function collectRoutes(app: NestFastifyApplication): RouteRule[] {
  const reflector = app.get(Reflector);
  const routes: RouteRule[] = [];

  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as (new (...args: unknown[]) => unknown) | null;
      if (!controller) continue;
      const proto = controller.prototype as Record<string, unknown>;

      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;

        const targets = [handler, controller];
        const permission = reflector.getAllAndOverride<string | undefined>(
          REQUIRED_PERMISSION,
          targets,
        );
        const rules = [
          reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets) ? 'public' : null,
          reflector.getAllAndOverride<boolean>(SELF_SERVICE, targets) ? 'self-service' : null,
          permission ? `permission:${permission}` : null,
        ].filter((rule): rule is string => rule !== null);

        const controllerPath = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
        const handlerPath = String(Reflect.getMetadata(PATH_METADATA, handler));
        const method =
          RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number] ?? '?';
        routes.push({
          endpoint: `${method} /${[controllerPath, handlerPath].filter((p) => p && p !== '/').join('/')}`,
          method,
          throttled:
            reflector.getAllAndOverride<number | undefined>(THROTTLER_LIMIT_DEFAULT, targets) !==
            undefined,
          route: `${controller.name}.${name} (${String(Reflect.getMetadata(PATH_METADATA, handler))})`,
          rules,
          permission,
        });
      }
    }
  }
  return routes;
}

describe('route access rules', () => {
  let app: NestFastifyApplication;
  let routes: RouteRule[];

  beforeAll(async () => {
    app = await createTestApp();
    routes = collectRoutes(app);
  });
  afterAll(() => app.close());

  it('finds the routes', () => {
    expect(routes.length).toBeGreaterThan(20);
  });

  it('gives every route exactly one access rule (deny by default)', () => {
    const offenders = routes
      .filter((r) => r.rules.length !== 1)
      .map((r) => `${r.route}: [${r.rules.join(', ')}]`);
    expect(offenders).toEqual([]);
  });

  it('only requires permissions that exist in the catalog', () => {
    const unknown = routes
      .filter((r) => r.permission && !isPermission(r.permission))
      .map((r) => r.route);
    expect(unknown).toEqual([]);
  });

  // Anonymous routes are the internet-facing surface. Adding one is a security decision, so it has to
  // be added here on purpose, with its reason, in the same change as the route itself.
  const APPROVED_PUBLIC_ROUTES: Record<string, string> = {
    'GET /health': 'liveness probe for the load balancer',
    'GET /health/ready': 'readiness probe for the load balancer',
    'GET /institution/public':
      'name, colours and switched-on modules for the sign-in page and website',
    'POST /auth/login': 'sign in (rate limited, lockout)',
    'POST /auth/password/forgot':
      'start a password reset (rate limited, never reveals whether an account exists)',
    'POST /auth/password/reset': 'finish a password reset with a single-use token (rate limited)',
    'POST /invitations/inspect':
      'look at an invitation before accepting it (single-use token, rate limited)',
    'POST /invitations/accept':
      'accept an invitation and set a password (single-use token, rate limited)',
    'GET /verify/:token':
      'check a certificate or ID card from its QR code (256-bit token, rate limited)',
    'GET /public/catalog': 'published courses for the website',
    'GET /public/courses/:id': 'one published course with its open classes',
    'GET /public/classes': 'upcoming classes with seats left',
    'GET /public/contact': 'how to reach the institution',
    'GET /public/posts': 'published news',
    'GET /public/posts/:slug': 'one published post',
    'POST /public/pre-registrations': 'apply to a course (idempotent, rate limited, honeypot)',
  };

  it('has only the anonymous routes we have reviewed', () => {
    const found = routes.filter((r) => r.rules.includes('public')).map((r) => r.endpoint);
    expect(found.sort()).toEqual(Object.keys(APPROVED_PUBLIC_ROUTES).sort());
  });

  it('rate-limits every anonymous route that takes a secret or changes something', () => {
    const unthrottled = routes
      .filter((r) => r.rules.includes('public') && !r.throttled)
      .filter((r) => r.method !== 'GET' || r.endpoint.startsWith('GET /verify/'))
      .map((r) => r.endpoint);
    expect(unthrottled).toEqual([]);
  });
});
