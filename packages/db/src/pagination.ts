import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * Keyset (cursor) pagination. Cursors are opaque base64url strings holding the sort key of
 * the last row. Unlike OFFSET, pages stay stable while rows are inserted and cost the same
 * no matter how deep you page. Always include a unique column (the UUIDv7 `id`) last.
 */

export type CursorValue = string | number;

export class InvalidCursorError extends Error {
  constructor() {
    super('Invalid pagination cursor');
    this.name = 'InvalidCursorError';
  }
}

export function encodeCursor(values: readonly CursorValue[]): string {
  return Buffer.from(JSON.stringify(values), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string, arity: number): CursorValue[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidCursorError();
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== arity ||
    !parsed.every((v) => typeof v === 'string' || typeof v === 'number')
  ) {
    throw new InvalidCursorError();
  }
  return parsed;
}

/** WHERE clause selecting rows strictly after the cursor, e.g. `(created_at, id) > ($1, $2)`. */
export function afterCursor(
  columns: readonly [AnyPgColumn, ...AnyPgColumn[]],
  values: readonly CursorValue[],
  direction: 'asc' | 'desc' = 'asc',
): SQL {
  if (values.length !== columns.length) throw new InvalidCursorError();
  const op = direction === 'asc' ? sql.raw('>') : sql.raw('<');
  const lhs = sql.join([...columns], sql`, `);
  const rhs = sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );
  return sql`(${lhs}) ${op} (${rhs})`;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Turn `limit + 1` fetched rows into a page: the extra row only signals that another page
 * exists and is dropped.
 */
export function toPage<T>(rows: T[], limit: number, cursorOf: (row: T) => CursorValue[]): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return { items, nextCursor: hasMore && last !== undefined ? encodeCursor(cursorOf(last)) : null };
}
