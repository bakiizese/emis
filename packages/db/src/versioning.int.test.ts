import { eq } from 'drizzle-orm';
import { pgTable, text } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createDatabase, createPool, type Database } from './client.js';
import { baseColumns } from './schema/columns.js';
import { updateWithVersion } from './versioning.js';

const urls = inject('database');

const widgets = pgTable('versioning_widgets', { ...baseColumns(), name: text().notNull() });

let pool: pg.Pool;
let db: Database;

beforeAll(async () => {
  const migrator = new pg.Client({ connectionString: urls.migratorUrl });
  await migrator.connect();
  await migrator.query(`
    CREATE TABLE versioning_widgets (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      created_by uuid,
      updated_by uuid,
      version integer NOT NULL DEFAULT 1,
      name text NOT NULL
    )`);
  await migrator.end();
  pool = createPool({ connectionString: urls.appUrl });
  db = createDatabase(pool);
});

afterAll(async () => {
  await pool.end();
  const migrator = new pg.Client({ connectionString: urls.migratorUrl });
  await migrator.connect();
  await migrator.query('DROP TABLE IF EXISTS versioning_widgets');
  await migrator.end();
});

async function insertWidget(name: string) {
  const [row] = await db.insert(widgets).values({ name }).returning();
  if (!row) throw new Error('insert failed');
  return row;
}

describe('updateWithVersion', () => {
  it('applies the update and bumps the version when versions match', async () => {
    const widget = await insertWidget('before');
    expect(widget.version).toBe(1);

    const result = await updateWithVersion(db, widgets, widget.id, 1, { name: 'after' });

    expect(result.status).toBe('updated');
    if (result.status !== 'updated') return;
    expect(result.row.name).toBe('after');
    expect(result.row.version).toBe(2);
    expect(result.row.updatedAt.getTime()).toBeGreaterThanOrEqual(widget.updatedAt.getTime());
  });

  it('reports a conflict on a stale version and leaves the row untouched', async () => {
    const widget = await insertWidget('original');
    await updateWithVersion(db, widgets, widget.id, 1, { name: 'first edit' });

    const stale = await updateWithVersion(db, widgets, widget.id, 1, { name: 'lost edit' });

    expect(stale).toEqual({ status: 'conflict', currentVersion: 2 });
    const [row] = await db.select().from(widgets).where(eq(widgets.id, widget.id));
    expect(row?.name).toBe('first edit');
  });

  it('reports not_found for an unknown id', async () => {
    const result = await updateWithVersion(db, widgets, '0199a1b2-0000-7000-8000-000000000000', 1, {
      name: 'x',
    });
    expect(result).toEqual({ status: 'not_found' });
  });

  it('lets exactly one of many concurrent writers win', async () => {
    const widget = await insertWidget('contended');

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        updateWithVersion(db, widgets, widget.id, 1, { name: `writer ${i}` }),
      ),
    );

    expect(results.filter((r) => r.status === 'updated')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'conflict')).toHaveLength(9);
  });
});
