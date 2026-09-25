import 'reflect-metadata';

import type { Type } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';

import { AppModule } from '../app.module.js';
import { configureApp, createFastifyAdapter } from '../app.setup.js';
import { loadEnv } from '../config/env.js';

export interface TestAppOptions {
  env?: Record<string, string>;
  /** Extra controllers/providers mounted for a test (e.g. a probe route). */
  controllers?: Type[];
  providers?: Type[];
}

/** Boots the real app (same module graph, same Fastify/helmet/docs setup as main.ts). */
export async function createTestApp(options: TestAppOptions = {}): Promise<NestFastifyApplication> {
  const env = loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    // Unreachable on purpose: pg connects lazily, so tests that don't query never touch it.
    DATABASE_URL: 'postgres://emis_app:unused@127.0.0.1:1/emis',
    ...options.env,
  });

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env)],
    controllers: options.controllers ?? [],
    providers: options.providers ?? [],
  }).compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter(env), {
    bufferLogs: true,
  });
  await configureApp(app, env);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
