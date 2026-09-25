import { z } from 'zod';

export const MAX_PAGE_SIZE = 100;

/** Query string for every list endpoint: `?cursor=…&limit=…`. */
export const pageQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;

/** Response envelope for list endpoints. `nextCursor` is null on the last page. */
export function pageSchema<TItem extends z.ZodType>(item: TItem) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}
