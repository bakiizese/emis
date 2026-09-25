import { and, eq, sql } from 'drizzle-orm';
import type {
  AnyPgColumn,
  PgDatabase,
  PgQueryResultHKT,
  PgTable,
  PgUpdateSetSource,
} from 'drizzle-orm/pg-core';

type VersionedTable = PgTable & { id: AnyPgColumn; version: AnyPgColumn };

export type VersionedUpdateResult<TRow> =
  | { status: 'updated'; row: TRow }
  | { status: 'conflict'; currentVersion: number }
  | { status: 'not_found' };

/**
 * Optimistic-locking update: only applies when the row is still at `expectedVersion`,
 * and bumps the version in the same statement. Callers map `conflict` to HTTP 412
 * (If-Match mismatch) and `not_found` to 404.
 */
export async function updateWithVersion<TTable extends VersionedTable>(
  db: PgDatabase<PgQueryResultHKT, Record<string, unknown>>,
  table: TTable,
  id: string,
  expectedVersion: number,
  values: Omit<PgUpdateSetSource<TTable>, 'id' | 'version'>,
): Promise<VersionedUpdateResult<TTable['$inferSelect']>> {
  const set = { ...values, version: sql`${table.version} + 1` } as PgUpdateSetSource<TTable>;

  const updated = (await db
    .update(table)
    .set(set)
    .where(and(eq(table.id, id), eq(table.version, expectedVersion)))
    .returning()) as TTable['$inferSelect'][];

  const row = updated[0];
  if (row) return { status: 'updated', row };

  const current = (await db
    .select({ version: table.version })
    // Drizzle can't narrow a generic table here, but tsc needs the widened type.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    .from(table as PgTable)
    .where(eq(table.id, id))) as { version: number }[];

  const found = current[0];
  return found ? { status: 'conflict', currentVersion: found.version } : { status: 'not_found' };
}
