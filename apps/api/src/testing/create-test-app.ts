import 'reflect-metadata';

import { randomBytes } from 'node:crypto';

import type { INestApplicationContext, Type } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';

import { AppModule } from '../app.module.js';
import { configureApp, createFastifyAdapter } from '../app.setup.js';
import { type Env, loadEnv } from '../config/env.js';
import type { OutgoingEmail } from '../mail/mailer.js';
import { MAILER } from '../mail/mailer.js';
import { OutboxDrain } from '../messaging/outbox-drain.service.js';
import { WorkerModule } from '../worker.module.js';
import { CapturingMailer } from './capturing-mailer.js';

export interface TestAppOptions {
  env?: Record<string, string>;
  /** Extra controllers/providers mounted for a test (e.g. a probe route). */
  controllers?: Type[];
  providers?: Type[];
}

export interface TestApp {
  app: NestFastifyApplication;
  /** Delivers queued outbox events (emails…) through the real handlers, then reads what was sent. */
  mail: {
    lastTo(address: string): Promise<OutgoingEmail | undefined>;
    sent(): Promise<OutgoingEmail[]>;
  };
  /** Runs the worker's handlers over every pending outbox event. */
  drain(): Promise<number>;
  worker: INestApplicationContext;
}

const TEST_ENCRYPTION_KEY = randomBytes(32).toString('base64');

export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    // Unreachable on purpose: pg connects lazily, so tests that don't query never touch it.
    DATABASE_URL: 'postgres://emis_app:unused@127.0.0.1:1/emis',
    ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    PORTAL_URL: 'https://portal.test',
    ...overrides,
  });
}

/** Boots the real HTTP app (same module graph, same Fastify/helmet/docs setup as main.ts). */
export async function createTestApp(options: TestAppOptions = {}): Promise<NestFastifyApplication> {
  const env = testEnv(options.env);
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

/** The HTTP app plus a queue-less worker on the same database, with email captured in memory. */
export async function createTestAppWithMailer(options: TestAppOptions = {}): Promise<TestApp> {
  const app = await createTestApp(options);
  const mailer = new CapturingMailer();
  const workerRef = await Test.createTestingModule({
    imports: [WorkerModule.forRoot(testEnv(options.env), { consume: false })],
  })
    .overrideProvider(MAILER)
    .useValue(mailer)
    .compile();
  const worker = await workerRef.init();

  const drain = () => worker.get(OutboxDrain).drain();
  const originalClose = app.close.bind(app);
  app.close = async () => {
    await worker.close();
    await originalClose();
  };

  return {
    app,
    worker,
    drain,
    mail: {
      lastTo: async (address) => {
        await drain();
        return mailer.lastTo(address);
      },
      sent: async () => {
        await drain();
        return mailer.sent;
      },
    },
  };
}
