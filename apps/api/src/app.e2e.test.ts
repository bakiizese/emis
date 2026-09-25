import {
  healthStatusSchema,
  type PageQuery,
  pageQuerySchema,
  problemDetailsSchema,
} from '@emis/contracts';
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { zodDto, ZodValidationPipe } from './common/zod/zod-validation.js';
import { Public } from './modules/identity/index.js';
import { createTestApp } from './testing/create-test-app.js';

const probeSchema = z.object({
  name: z.string().trim().min(2),
  age: z.number().int().positive().optional(),
});
class ProbeDto extends zodDto(probeSchema) {}

@Public()
@Controller('probe')
class ProbeController {
  @Post()
  create(@Body() body: ProbeDto) {
    return body;
  }

  @Get('list')
  list(@Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery) {
    return query;
  }

  @Get('boom')
  boom(): never {
    throw new Error('connect failed for postgres://emis_app:hunter2@db:5432/emis');
  }
}

function expectProblem(body: unknown, status: number, code: string) {
  const problem = problemDetailsSchema.parse(body);
  expect(problem.status).toBe(status);
  expect(problem.code).toBe(code);
  expect(problem.requestId).toBeTruthy();
  return problem;
}

describe('HTTP pipeline', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp({
      controllers: [ProbeController],
      env: { BODY_LIMIT_BYTES: '2048' },
    });
  });
  afterAll(() => app.close());

  it('serves liveness under /api/v1 with the shared contract', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(healthStatusSchema.parse(res.json()).service).toBe('api');
  });

  it('sets security headers and hides the framework', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('assigns a request id and echoes safe incoming ones', async () => {
    const minted = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(minted.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    const reused = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { 'x-request-id': 'caddy-req-12345' },
    });
    expect(reused.headers['x-request-id']).toBe('caddy-req-12345');

    const unsafe = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { 'x-request-id': 'bad id; drop' },
    });
    expect(unsafe.headers['x-request-id']).not.toBe('bad id; drop');
  });

  it('returns problem+json for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/nope?secret=1' });
    expect(res.headers['content-type']).toContain('application/problem+json');
    const problem = expectProblem(res.json(), 404, 'NOT_FOUND');
    expect(problem.instance).toBe('/api/v1/nope');
  });

  it('validates and transforms request bodies with Zod', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/probe',
      payload: { name: '  Hana  ' },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toEqual({ name: 'Hana' });

    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/probe',
      payload: { name: 'H', age: -3 },
    });
    const problem = expectProblem(bad.json(), 400, 'VALIDATION_FAILED');
    expect(problem.errors?.map((e) => e.path).sort()).toEqual(['age', 'name']);
  });

  it('validates query strings', async () => {
    const ok = await app.inject({ method: 'GET', url: '/api/v1/probe/list?limit=10' });
    expect(ok.json()).toEqual({ limit: 10 });

    const bad = await app.inject({ method: 'GET', url: '/api/v1/probe/list?limit=1000' });
    expectProblem(bad.json(), 400, 'VALIDATION_FAILED');
  });

  it('rejects malformed JSON without echoing it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/probe',
      headers: { 'content-type': 'application/json' },
      payload: '{"name": "sneaky-payload',
    });
    const problem = expectProblem(res.json(), 400, 'BAD_REQUEST');
    expect(JSON.stringify(problem)).not.toContain('sneaky-payload');
  });

  it('enforces the body size limit', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/probe',
      payload: { name: 'x'.repeat(4096) },
    });
    expectProblem(res.json(), 413, 'PAYLOAD_TOO_LARGE');
  });

  it('hides internal error details', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/probe/boom' });
    expectProblem(res.json(), 500, 'INTERNAL_ERROR');
    expect(res.body).not.toContain('hunter2');
  });

  it('reports not-ready with 503 when the database is unreachable', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
    expectProblem(res.json(), 503, 'SERVICE_UNAVAILABLE');
  });

  it('serves API docs with a pinned, integrity-checked script and a scoped CSP', async () => {
    const page = await app.inject({ method: 'GET', url: '/api/docs' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toMatch(/integrity="sha384-[A-Za-z0-9+/=]+"/);
    expect(page.headers['content-security-policy']).toContain('https://cdn.jsdelivr.net');
    expect(page.headers['content-security-policy']).not.toContain("'unsafe-eval'");

    const spec = await app.inject({ method: 'GET', url: '/api/docs/openapi.json' });
    const document = spec.json<{
      openapi: string;
      paths: Record<string, unknown>;
      components: { schemas: object };
    }>();
    expect(document.openapi).toMatch(/^3\./);
    expect(document.paths).toHaveProperty('/api/v1/health');
    expect(document.components.schemas).toHaveProperty('ProblemDetails');
  });
});

describe('rate limiting', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp({ controllers: [ProbeController], env: { RATE_LIMIT_MAX: '3' } });
  });
  afterAll(() => app.close());

  it('returns 429 with retry-after once the limit is hit', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await app.inject({ method: 'GET', url: '/api/v1/probe/list' });
      statuses.push(res.statusCode);
      if (res.statusCode === 429) {
        expectProblem(res.json(), 429, 'RATE_LIMITED');
        expect(res.headers['retry-after']).toBeDefined();
      }
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it('never throttles health probes', async () => {
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
      expect(res.statusCode).toBe(200);
    }
  });
});

describe('CORS and docs toggles', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp({
      env: { CORS_ORIGINS: 'https://portal.example.com', API_DOCS_ENABLED: 'false' },
    });
  });
  afterAll(() => app.close());

  it('allows only configured origins', async () => {
    const preflight = (origin: string) =>
      app.inject({
        method: 'OPTIONS',
        url: '/api/v1/health',
        headers: { origin, 'access-control-request-method': 'GET' },
      });

    expect(
      (await preflight('https://portal.example.com')).headers['access-control-allow-origin'],
    ).toBe('https://portal.example.com');
    expect(
      (await preflight('https://evil.example.com')).headers['access-control-allow-origin'],
    ).toBeUndefined();
  });

  it('does not expose docs when disabled', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/docs' });
    expect(res.statusCode).toBe(404);
  });
});
