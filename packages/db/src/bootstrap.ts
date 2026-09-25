import pg from 'pg';

/**
 * One-time (and safely re-runnable) database setup, run with a superuser connection.
 *
 * Creates three least-privilege roles and the application database:
 *   - migrator: owns the database and schema, runs migrations (DDL)
 *   - app:      the API and worker; SELECT/INSERT/UPDATE/DELETE only, no DDL, no TRUNCATE
 *   - readonly: reporting; SELECT only, read-only transactions by default
 *
 * Tables created later by the migrator are granted automatically through default privileges.
 */

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

async function upsertLoginRole(
  client: pg.Client,
  role: RoleCredentials,
): Promise<'created' | 'updated'> {
  const { rowCount } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role.user]);
  const exists = (rowCount ?? 0) > 0;
  await exec(
    client,
    exists
      ? 'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L'
      : 'CREATE ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
    role.user,
    role.password,
  );
  return exists ? 'updated' : 'created';
}

export async function bootstrapDatabase(options: BootstrapOptions): Promise<void> {
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
    await exec(admin, 'GRANT CONNECT ON DATABASE %I TO %I, %I', database, app.user, readonly.user);
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
    await exec(scoped, 'GRANT USAGE ON SCHEMA public TO %I, %I', app.user, readonly.user);

    // Future tables/sequences created by the migrator.
    await exec(
      scoped,
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
      migrator.user,
      app.user,
    );
    await exec(
      scoped,
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I',
      migrator.user,
      app.user,
    );
    await exec(
      scoped,
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON TABLES TO %I',
      migrator.user,
      readonly.user,
    );

    // Tables that already exist (re-running bootstrap after migrations).
    await exec(
      scoped,
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I',
      app.user,
    );
    await exec(scoped, 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', app.user);
    await exec(scoped, 'GRANT SELECT ON ALL TABLES IN SCHEMA public TO %I', readonly.user);
    log('schema privileges: applied');
  } finally {
    await scoped.end();
  }
}
