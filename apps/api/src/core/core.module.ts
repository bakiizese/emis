import { TransactionalAdapterDrizzleOrm } from '@nestjs-cls/transactional-adapter-drizzle-orm';
import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { type DynamicModule, Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';

import { CryptoModule } from '../common/crypto/crypto.module.js';
import { loggerOptions } from '../common/logging/logger.options.js';
import { APP_CONFIG, ConfigModule } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DatabaseModule, DRIZZLE } from '../database/database.module.js';
import { OutboxModule } from '../messaging/outbox.module.js';

/**
 * Infrastructure shared by the HTTP API and the background worker: config, logging, database with
 * @Transactional() support, encryption and the outbox publisher.
 */
@Module({})
export class CoreModule {
  static forRoot(env: Env, options: { http: boolean }): DynamicModule {
    return {
      module: CoreModule,
      imports: [
        ConfigModule.forRoot(env),
        LoggerModule.forRootAsync({ inject: [APP_CONFIG], useFactory: loggerOptions }),
        DatabaseModule,
        // Request-scoped context (HTTP) or explicit cls.run() (jobs); powers @Transactional().
        ClsModule.forRoot({
          global: true,
          middleware: { mount: options.http },
          plugins: [
            new ClsPluginTransactional({
              imports: [DatabaseModule],
              adapter: new TransactionalAdapterDrizzleOrm({ drizzleInstanceToken: DRIZZLE }),
            }),
          ],
        }),
        CryptoModule,
        OutboxModule,
      ],
    };
  }
}
