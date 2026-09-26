import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';

import { REQUEST_ID_HEADER, resolveRequestId } from './common/http/request-id.js';
import type { Env } from './config/env.js';
import { API_PREFIX } from './constants.js';
import { setupApiDocs } from './docs/api-docs.js';
import { registerCsrfProtection } from './modules/identity/index.js';

export function createFastifyAdapter(env: Env): FastifyAdapter {
  return new FastifyAdapter({
    trustProxy: env.TRUST_PROXY,
    bodyLimit: env.BODY_LIMIT_BYTES,
    requestIdHeader: false,
    genReqId: resolveRequestId,
    return503OnClosing: true,
  });
}

/** Everything main.ts and the e2e tests share, so tests exercise the real configuration. */
export async function configureApp(app: NestFastifyApplication, env: Env): Promise<void> {
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();

  // Strict defaults for a JSON API; the docs page relaxes CSP for itself only.
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: { maxAge: 31_536_000, includeSubDomains: true },
  });

  await app.register(cookie);

  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onRequest', (request, reply, done) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
    // Nothing from the API is meant to be kept by a browser or a proxy; a route that wants otherwise sets its own.
    void reply.header('Cache-Control', 'no-store');
    done();
  });
  registerCsrfProtection(fastify, env.TRUSTED_ORIGINS);

  if (env.CORS_ORIGINS.length > 0) {
    app.enableCors({
      origin: env.CORS_ORIGINS,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['content-type', 'idempotency-key', 'if-match', REQUEST_ID_HEADER],
      exposedHeaders: ['etag', REQUEST_ID_HEADER, 'retry-after'],
      maxAge: 600,
    });
  }

  if (env.API_DOCS_ENABLED) setupApiDocs(app);
}
