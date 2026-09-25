import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

/** `packages/db/migrations`, resolved from both `src/` and `dist/`. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Apply pending migrations as the migrator role. A session-level advisory lock makes
 * concurrent runs (e.g. two containers starting at once) wait instead of racing.
 */
export async function runMigrations(
  connectionString: string,
  migrationsFolder: string = MIGRATIONS_FOLDER,
): Promise<void> {
  const client = new pg.Client({ connectionString, application_name: 'emis-migrate' });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('emis.migrations'))");
    await migrate(drizzle({ client }), { migrationsFolder, migrationsSchema: 'drizzle' });
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtext('emis.migrations'))")
      .catch(() => undefined);
    await client.end();
  }
}
