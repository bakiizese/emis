import { describe, expect, it } from 'vitest';

import { decodeCursor, encodeCursor, InvalidCursorError, toPage } from './pagination.js';

describe('cursor encoding', () => {
  it('round-trips values', () => {
    const cursor = encodeCursor([
      '2026-09-25T10:00:00.000Z',
      '0199a1b2-0000-7000-8000-000000000001',
    ]);
    expect(decodeCursor(cursor, 2)).toEqual([
      '2026-09-25T10:00:00.000Z',
      '0199a1b2-0000-7000-8000-000000000001',
    ]);
  });

  it.each([
    ['not base64 json', 'e30'],
    ['wrong arity', encodeCursor(['a'])],
    ['non-scalar values', Buffer.from(JSON.stringify([{ a: 1 }, 'b'])).toString('base64url')],
    ['garbage', '!!!'],
  ])('rejects %s', (_label, cursor) => {
    expect(() => decodeCursor(cursor, 2)).toThrow(InvalidCursorError);
  });
});

describe('toPage', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('returns a next cursor when there are more rows than the limit', () => {
    const page = toPage(rows, 2, (r) => [r.id]);
    expect(page.items).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(page.nextCursor && decodeCursor(page.nextCursor, 1)).toEqual(['b']);
  });

  it('returns no cursor on the last page', () => {
    expect(toPage(rows, 3, (r) => [r.id]).nextCursor).toBeNull();
  });
});
