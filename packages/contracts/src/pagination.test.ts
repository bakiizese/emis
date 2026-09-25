import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { MAX_PAGE_SIZE, pageQuerySchema, pageSchema } from './pagination.js';

describe('pageQuerySchema', () => {
  it('defaults the limit and coerces query-string numbers', () => {
    expect(pageQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(pageQuerySchema.parse({ limit: '50', cursor: 'abc' })).toEqual({
      limit: 50,
      cursor: 'abc',
    });
  });

  it('rejects limits outside 1..MAX_PAGE_SIZE', () => {
    expect(pageQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(pageQuerySchema.safeParse({ limit: String(MAX_PAGE_SIZE + 1) }).success).toBe(false);
  });
});

describe('pageSchema', () => {
  it('wraps an item schema', () => {
    const schema = pageSchema(z.object({ id: z.string() }));
    expect(schema.parse({ items: [{ id: 'a' }], nextCursor: null }).items).toHaveLength(1);
  });
});
