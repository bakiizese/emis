import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { connect } from 'node:net';

import { bootstrapDatabase, parseConnectionUrl, runMigrations, syncSystemRoles } from '@emis/db';
import pg from 'pg';

import {
  E2E_DATABASE,
  E2E_VALKEY_DB,
  inDatabase,
  PORTS,
  REPO_ROOT,
  required,
  URLS,
} from './config.js';

export interface Seed {
  password: string;
  adminCookie: string;
  secretaryEmail: string;
  coordinatorEmail: string;
  branchId: string;
  course: { id: string; name: string };
  cohort: { id: string; name: string };
}

const LOG_DIR = `${REPO_ROOT}/apps/e2e/.logs`;

/** The environment every process of the test stack runs with. */
export function stackEnv(): NodeJS.ProcessEnv {
  const valkey = new URL(required('VALKEY_URL'));
  valkey.pathname = `/${E2E_VALKEY_DB}`;
  return {
    ...process.env,
    NODE_ENV: 'production',
    LOG_LEVEL: 'warn',
    API_HOST: '127.0.0.1',
    API_PORT: String(PORTS.api),
    DATABASE_URL: inDatabase(required('DATABASE_URL'), E2E_DATABASE),
    VALKEY_URL: valkey.toString(),
    PORTAL_URL: URLS.portal,
    WEB_URL: URLS.web,
    API_INTERNAL_URL: URLS.api,
    RATE_LIMIT_MAX: '100000',
    API_DOCS_ENABLED: 'false',
    CORS_ORIGINS: '',
    TRUST_PROXY: 'false',
  };
}

/** A brand-new database with the schema and system roles, so every run starts from nothing. */
export async function resetDatabase(): Promise<void> {
  const adminUrl = required('DATABASE_ADMIN_URL');
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${E2E_DATABASE} WITH (FORCE)`);
  } finally {
    await client.end();
  }
  await bootstrapDatabase({
    adminUrl,
    database: E2E_DATABASE,
    migrator: parseConnectionUrl(required('DATABASE_MIGRATOR_URL')),
    app: parseConnectionUrl(required('DATABASE_URL')),
    readonly: parseConnectionUrl(required('DATABASE_READONLY_URL')),
  });
  const migratorUrl = inDatabase(required('DATABASE_MIGRATOR_URL'), E2E_DATABASE);
  await runMigrations(migratorUrl);
  await syncSystemRoles(migratorUrl);
}

/** Empties the test's Valkey database (old sessions and queued jobs) with two raw commands. */
export async function flushValkey(): Promise<void> {
  const url = new URL(required('VALKEY_URL'));
  await new Promise<void>((resolve, reject) => {
    const socket = connect(Number(url.port || 6379), url.hostname);
    const command = (...parts: string[]) =>
      `*${parts.length}\r\n${parts.map((p) => `$${Buffer.byteLength(p)}\r\n${p}\r\n`).join('')}`;
    let replies = 0;
    const expected = (url.password ? 1 : 0) + 2;
    socket.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.startsWith('-')) {
        socket.destroy();
        reject(new Error(`Valkey said: ${text.trim()}`));
        return;
      }
      replies += (text.match(/\r\n/g) ?? []).length;
      if (replies >= expected) {
        socket.end();
        resolve();
      }
    });
    socket.on('error', reject);
    socket.on('connect', () => {
      if (url.password) socket.write(command('AUTH', decodeURIComponent(url.password)));
      socket.write(command('SELECT', String(E2E_VALKEY_DB)));
      socket.write(command('FLUSHDB'));
    });
  });
}

/** Runs the seed script in the API package and returns what it printed. */
export async function seed(): Promise<Seed> {
  const { stdout } = await run(
    'node',
    ['--import', '@swc-node/register/esm-register', 'src/testing/e2e-seed.ts'],
    `${REPO_ROOT}/apps/api`,
    { ...stackEnv(), LOG_LEVEL: 'silent', NODE_ENV: 'development' },
  );
  const line = stdout.split('\n').find((l) => l.startsWith('E2E_SEED '));
  if (!line) throw new Error(`The seed printed nothing usable:\n${stdout}`);
  return JSON.parse(line.slice('E2E_SEED '.length)) as Seed;
}

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  return new Promise<{ stdout: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('close', (code) =>
      code === 0
        ? resolve({ stdout })
        : reject(new Error(`${command} exited ${code}\n${stderr}\n${stdout}`)),
    );
  });
}

export interface Service {
  name: string;
  child: ChildProcess;
}

function start(name: string, args: string[], cwd: string): Service {
  mkdirSync(LOG_DIR, { recursive: true });
  const log = openSync(`${LOG_DIR}/${name}.log`, 'w');
  const child = spawn('node', args, {
    cwd,
    env: stackEnv(),
    stdio: ['ignore', log, log],
    detached: false,
  });
  return { name, child };
}

export function startServices(): Service[] {
  const next = (app: string, port: number) =>
    start(
      app,
      ['node_modules/next/dist/bin/next', 'start', '--port', String(port)],
      `${REPO_ROOT}/apps/${app}`,
    );
  return [
    start('api', ['dist/main.js'], `${REPO_ROOT}/apps/api`),
    start('worker', ['dist/worker.js'], `${REPO_ROOT}/apps/api`),
    next('web', PORTS.web),
    next('portal', PORTS.portal),
  ];
}

export async function waitFor(url: string, name: string, ms = 60_000): Promise<void> {
  const until = Date.now() + ms;
  let last = '';
  while (Date.now() < until) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.status < 500) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${name} did not come up at ${url} (${last}). See apps/e2e/.logs/${name}.log`);
}

export function stopServices(services: Service[]): void {
  for (const { child } of services) child.kill('SIGTERM');
}
