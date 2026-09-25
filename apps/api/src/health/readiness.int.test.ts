import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createTestApp } from '../testing/create-test-app.js';

describe('GET /api/v1/health/ready (real database)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp({ env: { DATABASE_URL: inject('database').appUrl } });
  });
  afterAll(() => app.close());

  it('reports the database as up', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', info: { database: { status: 'up' } } });
  });
});
