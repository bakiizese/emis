import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

// The same .env the dev stack uses (never overriding what the shell already set): this is how the
// test finds Postgres, Valkey, Gotenberg and Mailpit, which `pnpm infra:up` starts.
const envFile = `${REPO_ROOT}/.env`;
if (existsSync(envFile)) process.loadEnvFile(envFile);

export const PORTS = { api: 4200, web: 3200, portal: 3201 } as const;
export const URLS = {
  api: `http://127.0.0.1:${PORTS.api}`,
  web: `http://localhost:${PORTS.web}`,
  portal: `http://localhost:${PORTS.portal}`,
} as const;
export const E2E_DATABASE = 'emis_e2e';
/** Valkey database number: keeps test queues and sessions apart from the dev stack's. */
export const E2E_VALKEY_DB = 5;

export function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env, run "pnpm infra:up" and "pnpm db:bootstrap", then try again.`,
    );
  }
  return value;
}

export const inDatabase = (url: string, database: string): string => {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
};

export const MAILPIT_URL = `http://localhost:${process.env.MAILPIT_UI_PORT ?? '8025'}`;
