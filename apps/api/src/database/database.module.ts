import type { TransactionalAdapterDrizzleOrm } from '@nestjs-cls/transactional-adapter-drizzle-orm';
import { createDatabase, createPool, type Database } from '@emis/db';
import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import type pg from 'pg';

import { APP_CONFIG } from '../config/config.module.js';
import type { Env } from '../config/env.js';

export const PG_POOL = Symbol('PG_POOL');
/** Drizzle instance. Inside `@Transactional()` code prefer `TransactionHost` so queries join the transaction. */
export const DRIZZLE = Symbol('DRIZZLE');

export type { Database };

/**
 * Adapter type for `TransactionHost<DbAdapter>`. Inject the host with the class written out
 * (`TransactionHost<DbAdapter>`), never through a type alias, or DI metadata is lost.
 */
export type DbAdapter = TransactionalAdapterDrizzleOrm<Database>;

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (env: Env): pg.Pool => {
        const pool = createPool({
          connectionString: env.DATABASE_URL,
          max: env.DATABASE_POOL_MAX,
          statementTimeoutMs: env.DATABASE_STATEMENT_TIMEOUT_MS,
          applicationName: 'emis-api',
        });
        // An idle client erroring (e.g. the server restarted) must not crash the process.
        pool.on('error', (err) =>
          new Logger('Database').error(`idle client error: ${err.message}`),
        );
        return pool;
      },
    },
    { provide: DRIZZLE, inject: [PG_POOL], useFactory: (pool: pg.Pool) => createDatabase(pool) },
  ],
  exports: [PG_POOL, DRIZZLE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
