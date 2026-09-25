import { TransactionalAdapterDrizzleOrm } from '@nestjs-cls/transactional-adapter-drizzle-orm';
import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';

import { ProblemDetailsFilter } from './common/http/problem-details.filter.js';
import { loggerOptions } from './common/logging/logger.options.js';
import { ZodValidationPipe } from './common/zod/zod-validation.js';
import { APP_CONFIG, ConfigModule } from './config/config.module.js';
import type { Env } from './config/env.js';
import { DatabaseModule, DRIZZLE } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';

@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(env),
        LoggerModule.forRootAsync({ inject: [APP_CONFIG], useFactory: loggerOptions }),
        DatabaseModule,
        // Request-scoped context; powers @Transactional() so nested services share one transaction.
        ClsModule.forRoot({
          global: true,
          middleware: { mount: true },
          plugins: [
            new ClsPluginTransactional({
              imports: [DatabaseModule],
              adapter: new TransactionalAdapterDrizzleOrm({ drizzleInstanceToken: DRIZZLE }),
            }),
          ],
        }),
        ThrottlerModule.forRootAsync({
          inject: [APP_CONFIG],
          useFactory: (config: Env) => ({
            throttlers: [
              { name: 'default', ttl: config.RATE_LIMIT_TTL_MS, limit: config.RATE_LIMIT_MAX },
            ],
          }),
        }),
        HealthModule,
      ],
      providers: [
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        { provide: APP_PIPE, useFactory: () => new ZodValidationPipe() },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    };
  }
}
