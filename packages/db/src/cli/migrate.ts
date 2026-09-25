import { runMigrations } from '../migrate.js';
import { syncSystemRoles } from '../reference/system-roles.js';
import { requireEnv } from './env.js';

const url = requireEnv('DATABASE_MIGRATOR_URL');
await runMigrations(url);
await syncSystemRoles(url);
console.warn('[migrate] database is up to date, system roles synced');
