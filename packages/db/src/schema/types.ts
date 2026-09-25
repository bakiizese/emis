import { customType } from 'drizzle-orm/pg-core';

/** Case-insensitive text (citext extension): emails compare and index without lower(). */
export const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});
