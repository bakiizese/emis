import { isPermission } from '@emis/permissions';
import { ModulesContainer, Reflector } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { IS_PUBLIC } from '../../modules/identity/index.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { REQUIRED_PERMISSION, SELF_SERVICE } from './decorators.js';

// Nest stores the route path/method under these metadata keys on each handler.
const PATH_METADATA = 'path';
const METHOD_METADATA = 'method';

interface RouteRule {
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

        routes.push({
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
});
