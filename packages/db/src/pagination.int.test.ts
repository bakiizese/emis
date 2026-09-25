import { desc } from 'drizzle-orm';
import { pgTable, text } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createDatabase, createPool, type Database } from './client.js';
import { afterCursor, decodeCursor, toPage } from './pagination.js';
import { idColumn, timestampColumns } from './schema/columns.js';

const urls = inject('database');

const items = pgTable('pagination_items', {
  id: idColumn(),
  ...timestampColumns(),
  label: text().notNull(),
});

let pool: pg.Pool;
let db: Database;

beforeAll(async () => {
  const migrator = new pg.Client({ connectionString: urls.migratorUrl });
  await migrator.connect();
  await migrator.query(`
    CREATE TABLE pagination_items (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      label text NOT NULL
    )`);
  await migrator.end();
  pool = createPool({ connectionString: urls.appUrl });
  db = createDatabase(pool);

  // Several rows share a timestamp on purpose: the id tiebreaker must keep pages exact.
  const base = new Date('2026-09-01T08:00:00Z').getTime();
  await db.insert(items).values(
    Array.from({ length: 25 }, (_, i) => ({
      label: `item-${i}`,
      createdAt: new Date(base + Math.floor(i / 3) * 60_000),
    })),
  );
});

afterAll(async () => {
  await pool.end();
  const migrator = new pg.Client({ connectionString: urls.migratorUrl });
  await migrator.connect();
  await migrator.query('DROP TABLE IF EXISTS pagination_items');
  await migrator.end();
});

async function fetchPage(limit: number, cursor: string | null) {
  let where;
  if (cursor) {
    const [createdAt, id] = decodeCursor(cursor, 2);
    where = afterCursor([items.createdAt, items.id], [String(createdAt), String(id)], 'desc');
  }
  const rows = await db
    .select()
    .from(items)
    .where(where)
    .orderBy(desc(items.createdAt), desc(items.id))
    .limit(limit + 1);
  return toPage(rows, limit, (r) => [r.createdAt.toISOString(), r.id]);
}

describe('keyset pagination', () => {
  it('walks every row exactly once, newest first', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const page = await fetchPage(10, cursor);
      seen.push(...page.items.map((r) => r.label));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor);

    expect(pages).toBe(3);
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
  });
});
