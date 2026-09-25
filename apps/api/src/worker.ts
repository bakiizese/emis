import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { loadEnv } from './config/env.js';
import { WorkerModule } from './worker.module.js';

/** Background worker: relays the outbox, runs event handlers (email…) and scheduled housekeeping. */
async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(env), {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.get(Logger).log('worker started');
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
