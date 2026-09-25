import 'reflect-metadata';

import { healthStatusSchema } from '@emis/contracts';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module.js';
import { API_PREFIX } from '../constants.js';

describe('GET /api/v1/health', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix(API_PREFIX);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a payload matching the shared contract', async () => {
    const response = await app.inject({ method: 'GET', url: `/${API_PREFIX}/health` });

    expect(response.statusCode).toBe(200);
    const body = healthStatusSchema.parse(response.json());
    expect(body.service).toBe('api');
  });
});
