import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

export interface PoolOptions {
  connectionString: string;
  /** Maximum connections in the pool. */
  max?: number;
  /** Kill any single statement that runs longer than this. */
  statementTimeoutMs?: number;
  /** Shows up in pg_stat_activity, handy when debugging production. */
  applicationName?: string;
}

export function createPool(options: PoolOptions): pg.Pool {
  return new pg.Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    idle_in_transaction_session_timeout: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: options.applicationName ?? 'emis',
  });
}

export function createDatabase(pool: pg.Pool): Database {
  return drizzle({ client: pool, schema, casing: 'snake_case' });
}
