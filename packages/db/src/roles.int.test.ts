import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { bootstrapDatabase } from './bootstrap.js';

const urls = inject('database');

async function withClient<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

describe('database roles', () => {
  beforeAll(async () => {
    await withClient(urls.migratorUrl, (c) =>
      c.query(
        'CREATE TABLE roles_probe (id uuid PRIMARY KEY DEFAULT uuidv7(), note text NOT NULL)',
      ),
    );
  });

  afterAll(async () => {
    await withClient(urls.migratorUrl, (c) => c.query('DROP TABLE IF EXISTS roles_probe'));
  });

  it('migrations installed the required extensions', async () => {
    const { rows } = await withClient(urls.appUrl, (c) =>
      c.query<{ extname: string }>('SELECT extname FROM pg_extension ORDER BY extname'),
    );
    expect(rows.map((r) => r.extname)).toEqual(
      expect.arrayContaining(['btree_gist', 'citext', 'pg_trgm']),
    );
  });

  it('app role can read and write rows in tables created by the migrator', async () => {
    await withClient(urls.appUrl, async (c) => {
      const inserted = await c.query<{ id: string }>(
        "INSERT INTO roles_probe (note) VALUES ('hello') RETURNING id",
      );
      const id = inserted.rows[0]?.id;
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      await c.query("UPDATE roles_probe SET note = 'changed' WHERE id = $1", [id]);
      await c.query('DELETE FROM roles_probe WHERE id = $1', [id]);
    });
  });

  it('app role cannot change the schema or wipe tables', async () => {
    await withClient(urls.appUrl, async (c) => {
      await expect(c.query('CREATE TABLE sneaky (id int)')).rejects.toThrow(/permission denied/);
      await expect(c.query('DROP TABLE roles_probe')).rejects.toThrow(/must be owner/);
      await expect(c.query('TRUNCATE roles_probe')).rejects.toThrow(/permission denied/);
      await expect(c.query('ALTER TABLE roles_probe ADD COLUMN x int')).rejects.toThrow(
        /must be owner/,
      );
    });
  });

  it('readonly role can select but never write', async () => {
    await withClient(urls.readonlyUrl, async (c) => {
      await expect(c.query('SELECT count(*) FROM roles_probe')).resolves.toBeDefined();
      await expect(c.query("INSERT INTO roles_probe (note) VALUES ('x')")).rejects.toThrow(
        /read-only transaction|permission denied/,
      );
    });
  });

  it('security events are append-only for the app role', async () => {
    await withClient(urls.appUrl, async (c) => {
      await c.query("INSERT INTO security_events (type) VALUES ('test.append_only')");
      await expect(c.query("UPDATE security_events SET type = 'tampered'")).rejects.toThrow(
        /permission denied/,
      );
      await expect(c.query('DELETE FROM security_events')).rejects.toThrow(/permission denied/);
      await expect(c.query('TRUNCATE security_events')).rejects.toThrow(/permission denied/);
    });
  });

  it('login roles get privileges only through the writer/reader groups', async () => {
    const { rows } = await withClient(urls.adminUrl.replace(/\/postgres$/, '/emis_test'), (c) =>
      c.query<{ grantee: string }>(
        "SELECT DISTINCT grantee FROM information_schema.role_table_grants WHERE table_schema = 'public'",
      ),
    );
    const grantees = rows.map((r) => r.grantee);
    expect(grantees).toEqual(expect.arrayContaining(['emis_writer', 'emis_reader']));
    expect(grantees).not.toContain('emis_app');
    expect(grantees).not.toContain('emis_readonly');
  });

  it('bootstrap is safe to re-run and rotates passwords', async () => {
    // Separate database and roles, so rotating a password never affects other test files.
    const database = 'emis_rotation_test';
    const migrator = { user: 'rot_migrator', password: 'rot-migrator-pw' };
    const app = { user: 'rot_app', password: 'rot-app-pw' };
    const readonly = { user: 'rot_readonly', password: 'rot-readonly-pw' };
    const urlFor = (user: string, password: string) => {
      const url = new URL(urls.adminUrl);
      url.username = user;
      url.password = password;
      url.pathname = `/${database}`;
      return url.toString();
    };

    await bootstrapDatabase({ adminUrl: urls.adminUrl, database, migrator, app, readonly });
    await bootstrapDatabase({ adminUrl: urls.adminUrl, database, migrator, app, readonly });
    await expect(
      withClient(urlFor(app.user, app.password), (c) => c.query('SELECT 1')),
    ).resolves.toBeDefined();

    const rotated = { ...app, password: 'rot-app-pw-2' };
    await bootstrapDatabase({
      adminUrl: urls.adminUrl,
      database,
      migrator,
      app: rotated,
      readonly,
    });

    await expect(
      withClient(urlFor(app.user, rotated.password), (c) => c.query('SELECT 1')),
    ).resolves.toBeDefined();
    await expect(
      withClient(urlFor(app.user, app.password), (c) => c.query('SELECT 1')),
    ).rejects.toThrow(/password authentication failed/);
  });
});
