import { problemDetailsSchema } from '@emis/contracts';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { toOpenApiSchema } from '../common/zod/openapi.js';
import { API_VERSION } from '../version.js';

// Scalar API reference, pinned with Subresource Integrity so a CDN compromise can't inject code.
const SCALAR_SRC =
  'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.72.0/dist/browser/standalone.js';
const SCALAR_SRI = 'sha384-OPr81V05YKGVtMFR7bgn6teWINJ+Qb5LIgvuAi2xv2C/5Y1/PcjZ0DrvpMdP39ix';

export const DOCS_PATH = '/api/docs';

const DOCS_CSP = [
  "default-src 'none'",
  "script-src 'self' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.scalar.com",
  "font-src 'self' data: https://fonts.scalar.com",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const DOCS_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>EMIS API reference</title>
  </head>
  <body>
    <div id="app"></div>
    <script src="${SCALAR_SRC}" integrity="${SCALAR_SRI}" crossorigin="anonymous"></script>
    <script src="${DOCS_PATH}/init.js"></script>
  </body>
</html>`;

// Served as a file so the page needs no inline script (keeps the CSP strict).
const DOCS_INIT_JS = `Scalar.createApiReference('#app', { url: '${DOCS_PATH}/openapi.json', hideClientButton: true });`;

/** Builds the OpenAPI document from the controllers and serves it with an interactive reference. */
export function setupApiDocs(app: NestFastifyApplication): void {
  const config = new DocumentBuilder()
    .setTitle('EMIS API')
    .setDescription(
      'Education Management Information System. Errors are RFC 9457 problem details (application/problem+json).',
    )
    .setVersion(API_VERSION)
    .build();

  const document = SwaggerModule.createDocument(app, config);
  document.components = {
    ...document.components,
    schemas: {
      ...document.components?.schemas,
      ProblemDetails: toOpenApiSchema(problemDetailsSchema),
    },
  };

  const fastify = app.getHttpAdapter().getInstance();
  fastify.get(`${DOCS_PATH}/openapi.json`, (_request, reply) => reply.send(document));
  fastify.get(`${DOCS_PATH}/init.js`, (_request, reply) =>
    reply.type('text/javascript; charset=utf-8').send(DOCS_INIT_JS),
  );
  fastify.get(DOCS_PATH, (_request, reply) =>
    reply
      .header('content-security-policy', DOCS_CSP)
      .type('text/html; charset=utf-8')
      .send(DOCS_HTML),
  );
}
