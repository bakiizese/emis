import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { ProblemDetailsFilter } from './common/http/problem-details.filter.js';
import { IdempotencyInterceptor } from './common/idempotency/idempotency.interceptor.js';
import { ZodValidationPipe } from './common/zod/zod-validation.js';
import { APP_CONFIG } from './config/config.module.js';
import type { Env } from './config/env.js';
import { CoreModule } from './core/core.module.js';
import { HealthModule } from './health/health.module.js';
import { MailModule } from './mail/mail.module.js';
import { AccessModule, PermissionGuard } from './modules/access/index.js';
import { AuditModule } from './modules/audit/index.js';
import { AuthGuard, IdentityModule } from './modules/identity/index.js';
import { ModuleGuard, SettingsModule } from './modules/settings/index.js';

@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot(env, { http: true }),
        ThrottlerModule.forRootAsync({
          inject: [APP_CONFIG],
          useFactory: (config: Env) => ({
            throttlers: [
              { name: 'default', ttl: config.RATE_LIMIT_TTL_MS, limit: config.RATE_LIMIT_MAX },
            ],
          }),
        }),
        MailModule,
        HealthModule,
        IdentityModule,
        AuditModule,
        SettingsModule,
        AccessModule,
      ],
      providers: [
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        { provide: APP_PIPE, useFactory: () => new ZodValidationPipe() },
        // Order matters: rate-limit first (even anonymous traffic), then require a session,
        // then check the route's permission, then whether its module is switched on.
        // Routes with no access rule are denied.
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useExisting: AuthGuard },
        { provide: APP_GUARD, useExisting: PermissionGuard },
        { provide: APP_GUARD, useExisting: ModuleGuard },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
      ],
    };
  }
}
