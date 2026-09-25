import { runMigrations } from '../migrate.js';
import { requireEnv } from './env.js';

await runMigrations(requireEnv('DATABASE_MIGRATOR_URL'));
console.warn('[migrate] database is up to date');
