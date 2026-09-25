import pg from 'pg';

/**
 * One-time (and safely re-runnable) database setup, run with a superuser connection.
 *
 * Creates three least-privilege roles and the application database:
 *   - migrator: owns the database and schema, runs migrations (DDL)
 *   - app:      the API and worker; SELECT/INSERT/UPDATE/DELETE only, no DDL, no TRUNCATE
 *   - readonly: reporting; SELECT only, read-only transactions by default
 *
 * Privileges go to two fixed group roles (NOLOGIN) that the login roles belong to:
 *   - emis_writer: row read/write, member = app role
 *   - emis_reader: row read,       member = readonly role
 * Login role names are configurable per install, but migrations can always target the groups,
 * e.g. `REVOKE UPDATE, DELETE ON security_events FROM emis_writer` for append-only tables.
 *
 * Tables created later by the migrator are granted automatically through default privileges.
 */

export const WRITER_GROUP = 'emis_writer';
export const READER_GROUP = 'emis_reader';

export interface RoleCredentials {
  user: string;
  password: string;
}

export interface BootstrapOptions {
  /** Superuser connection string (any database, usually `postgres`). */
  adminUrl: string;
  database: string;
  migrator: RoleCredentials;
  app: RoleCredentials;
  readonly: RoleCredentials;
  log?: (message: string) => void;
}

export interface ConnectionParts extends RoleCredentials {
  database: string;
}

/** Extract role name, password and database name from a postgres:// URL. */
export function parseConnectionUrl(connectionString: string): ConnectionParts {
  const url = new URL(connectionString);
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error(`Expected a postgres:// URL, got ${url.protocol}`);
  }
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!user || !password || !database) {
    throw new Error('Connection URL must include a user, a password and a database name');
  }
  return { user, password, database };
}

/** Build a SQL statement server-side with format(), so identifiers and literals are quoted safely. */
async function formatSql(client: pg.Client, template: string, ...args: string[]): Promise<string> {
  const placeholders = args.map((_, i) => `$${i + 2}::text`).join(', ');
  const { rows } = await client.query<{ statement: string }>(
    `SELECT format($1, ${placeholders}) AS statement`,
    [template, ...args],
  );
  const statement = rows[0]?.statement;
  if (!statement) throw new Error('format() returned no statement');
  return statement;
}

async function exec(client: pg.Client, template: string, ...args: string[]): Promise<void> {
  await client.query(await formatSql(client, template, ...args));
}

const ROLE_ATTRIBUTES = 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT';

async function roleExists(client: pg.Client, name: string): Promise<boolean> {
  const { rowCount } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [name]);
  return (rowCount ?? 0) > 0;
}

async function upsertLoginRole(
  client: pg.Client,
  role: RoleCredentials,
): Promise<'created' | 'updated'> {
  const exists = await roleExists(client, role.user);
  await exec(
    client,
    `${exists ? 'ALTER' : 'CREATE'} ROLE %I WITH LOGIN ${ROLE_ATTRIBUTES} PASSWORD %L`,
    role.user,
    role.password,
  );
  return exists ? 'updated' : 'created';
}

async function ensureGroupRole(client: pg.Client, name: string): Promise<void> {
  if (!(await roleExists(client, name))) {
    await exec(client, `CREATE ROLE %I WITH NOLOGIN ${ROLE_ATTRIBUTES}`, name);
  }
}

async function bootstrapUnlocked(options: BootstrapOptions): Promise<void> {
  const log = options.log ?? (() => undefined);
  const { database, migrator, app, readonly } = options;
  const roles = [migrator.user, app.user, readonly.user];
  if (new Set(roles).size !== roles.length) {
    throw new Error('migrator, app and readonly must be three different roles');
  }

  const admin = new pg.Client({
    connectionString: options.adminUrl,
    application_name: 'emis-bootstrap',
  });
  await admin.connect();
  try {
    for (const role of [migrator, app, readonly]) {
      log(`role ${role.user}: ${await upsertLoginRole(admin, role)}`);
    }
    await ensureGroupRole(admin, WRITER_GROUP);
    await ensureGroupRole(admin, READER_GROUP);
    await exec(admin, 'GRANT %I TO %I WITH INHERIT TRUE', WRITER_GROUP, app.user);
    await exec(admin, 'GRANT %I TO %I WITH INHERIT TRUE', READER_GROUP, readonly.user);

    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      database,
    ]);
    if ((rowCount ?? 0) === 0) {
      await exec(admin, 'CREATE DATABASE %I OWNER %I', database, migrator.user);
      log(`database ${database}: created`);
    } else {
      await exec(admin, 'ALTER DATABASE %I OWNER TO %I', database, migrator.user);
      log(`database ${database}: exists, owner ensured`);
    }

    await exec(admin, 'REVOKE ALL ON DATABASE %I FROM PUBLIC', database);
    await exec(
      admin,
      'GRANT CONNECT ON DATABASE %I TO %I, %I',
      database,
      WRITER_GROUP,
      READER_GROUP,
    );
    await exec(admin, 'ALTER ROLE %I SET default_transaction_read_only = on', readonly.user);
  } finally {
    await admin.end();
  }

  // Schema-level privileges have to be set from inside the target database.
  const adminUrl = new URL(options.adminUrl);
  adminUrl.pathname = `/${encodeURIComponent(database)}`;
  const scoped = new pg.Client({
    connectionString: adminUrl.toString(),
    application_name: 'emis-bootstrap',
  });
  await scoped.connect();
  try {
    await scoped.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await exec(scoped, 'GRANT USAGE ON SCHEMA public TO %I, %I', WRITER_GROUP, READER_GROUP);

    // Future tables/sequences created by the migrator.
    await exec(
      scoped,
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
      migrator.user,
      WRITER_GROUP,
    );
    await exec(
      scoped,
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I',
      migrator.user,
      WRITER_GROUP,
    );
    await exec(
      scoped,
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON TABLES TO %I',
      migrator.user,
      READER_GROUP,
    );
    // Tables that already exist (re-running bootstrap after migrations).
    await exec(
      scoped,
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I',
      WRITER_GROUP,
    );
    await exec(scoped, 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', WRITER_GROUP);
    await exec(scoped, 'GRANT SELECT ON ALL TABLES IN SCHEMA public TO %I', READER_GROUP);

    // Privileges only ever flow through the groups: drop anything granted to login roles directly,
    // so a direct grant can never bypass a per-table REVOKE on the group.
    for (const login of [app.user, readonly.user]) {
      await exec(
        scoped,
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM %I',
        migrator.user,
        login,
      );
      await exec(
        scoped,
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I',
        migrator.user,
        login,
      );
      await exec(scoped, 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', login);
      await exec(scoped, 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', login);
    }

    log('schema privileges: applied');
  } finally {
    await scoped.end();
  }
}

/**
 * Role and database DDL isn't safe to run concurrently: two bootstraps at once can fail with
 * "tuple concurrently updated". A cluster-level advisory lock (taken in the admin database)
 * makes parallel runs (two installers, parallel test files) queue up instead.
 */
export async function bootstrapDatabase(options: BootstrapOptions): Promise<void> {
  const lock = new pg.Client({
    connectionString: options.adminUrl,
    application_name: 'emis-bootstrap-lock',
  });
  await lock.connect();
  try {
    await lock.query("SELECT pg_advisory_lock(hashtext('emis.bootstrap'))");
    await bootstrapUnlocked(options);
  } finally {
    await lock
      .query("SELECT pg_advisory_unlock(hashtext('emis.bootstrap'))")
      .catch(() => undefined);
    await lock.end();
  }
}
