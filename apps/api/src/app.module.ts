import { TransactionalAdapterDrizzleOrm } from '@nestjs-cls/transactional-adapter-drizzle-orm';
import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';

import { CryptoModule } from './common/crypto/crypto.module.js';
import { ProblemDetailsFilter } from './common/http/problem-details.filter.js';
import { loggerOptions } from './common/logging/logger.options.js';
import { ZodValidationPipe } from './common/zod/zod-validation.js';
import { APP_CONFIG, ConfigModule } from './config/config.module.js';
import type { Env } from './config/env.js';
import { DatabaseModule, DRIZZLE } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { MailModule } from './mail/mail.module.js';
import { AccessModule, PermissionGuard } from './modules/access/index.js';
import { AuditModule } from './modules/audit/index.js';
import { AuthGuard, IdentityModule } from './modules/identity/index.js';

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
        CryptoModule,
        MailModule,
        HealthModule,
        IdentityModule,
        AuditModule,
        AccessModule,
      ],
      providers: [
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        { provide: APP_PIPE, useFactory: () => new ZodValidationPipe() },
        // Order matters: rate-limit first (even anonymous traffic), then require a session,
        // then check the route's permission. Routes with no access rule are denied.
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useExisting: AuthGuard },
        { provide: APP_GUARD, useExisting: PermissionGuard },
      ],
    };
  }
}
