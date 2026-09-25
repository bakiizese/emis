import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

import { bootstrapDatabase, parseConnectionUrl } from '../bootstrap.js';
import { runMigrations } from '../migrate.js';
import { syncSystemRoles } from '../reference/system-roles.js';

export interface TestDatabaseUrls {
  adminUrl: string;
  migratorUrl: string;
  appUrl: string;
  readonlyUrl: string;
}

// Typed `inject('database')` in any package that runs this global setup.
declare module 'vitest' {
  export interface ProvidedContext {
    database: TestDatabaseUrls;
  }
}

export interface TestDatabase {
  urls: TestDatabaseUrls;
  stop: () => Promise<void>;
}

const DATABASE = 'emis_test';
const roles = {
  migrator: { user: 'emis_migrator', password: 'migrator-test-pw' },
  app: { user: 'emis_app', password: 'app-test-pw' },
  readonly: { user: 'emis_readonly', password: 'readonly-test-pw' },
};

/**
 * Throwaway PostgreSQL 18 for integration tests, set up exactly like production:
 * same role bootstrap, same migrations. Used from vitest global setups.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:18-alpine')
    .withUsername('postgres')
    .withPassword('postgres-test-pw')
    .withDatabase('postgres')
    .start();

  const host = container.getHost();
  const port = container.getPort();
  const url = (user: string, password: string) =>
    `postgres://${user}:${password}@${host}:${port}/${DATABASE}`;

  const urls: TestDatabaseUrls = {
    adminUrl: container.getConnectionUri(),
    migratorUrl: url(roles.migrator.user, roles.migrator.password),
    appUrl: url(roles.app.user, roles.app.password),
    readonlyUrl: url(roles.readonly.user, roles.readonly.password),
  };

  await bootstrapDatabase({ adminUrl: urls.adminUrl, database: DATABASE, ...roles });
  await runMigrations(urls.migratorUrl);
  await syncSystemRoles(urls.migratorUrl);

  return { urls, stop: async () => void (await container.stop()) };
}

/**
 * A separate database inside the shared test container, set up like production. Use it when a
 * test file needs global state to itself (e.g. "is this the last admin?") while other files run
 * in parallel.
 */
export async function createIsolatedDatabase(
  base: TestDatabaseUrls,
  name: string,
): Promise<TestDatabaseUrls> {
  const inDatabase = (url: string) => {
    const parsed = new URL(url);
    parsed.pathname = `/${name}`;
    return parsed.toString();
  };
  const urls: TestDatabaseUrls = {
    adminUrl: inDatabase(base.adminUrl),
    migratorUrl: inDatabase(base.migratorUrl),
    appUrl: inDatabase(base.appUrl),
    readonlyUrl: inDatabase(base.readonlyUrl),
  };

  await bootstrapDatabase({
    adminUrl: base.adminUrl,
    database: name,
    migrator: parseConnectionUrl(base.migratorUrl),
    app: parseConnectionUrl(base.appUrl),
    readonly: parseConnectionUrl(base.readonlyUrl),
  });
  await runMigrations(urls.migratorUrl);
  await syncSystemRoles(urls.migratorUrl);
  return urls;
}
