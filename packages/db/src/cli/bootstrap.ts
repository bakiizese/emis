import { bootstrapDatabase, parseConnectionUrl } from '../bootstrap.js';
import { requireEnv } from './env.js';

// Role credentials come from the same URLs the services use, so there is one source of truth.
const migrator = parseConnectionUrl(requireEnv('DATABASE_MIGRATOR_URL'));
const app = parseConnectionUrl(requireEnv('DATABASE_URL'));
const readonly = parseConnectionUrl(requireEnv('DATABASE_READONLY_URL'));

if (new Set([migrator.database, app.database, readonly.database]).size !== 1) {
  console.error(
    'DATABASE_MIGRATOR_URL, DATABASE_URL and DATABASE_READONLY_URL must use the same database',
  );
  process.exit(1);
}

await bootstrapDatabase({
  adminUrl: requireEnv('DATABASE_ADMIN_URL'),
  database: migrator.database,
  migrator,
  app,
  readonly,
  log: (message) => console.warn(`[bootstrap] ${message}`),
});
console.warn('[bootstrap] done');
