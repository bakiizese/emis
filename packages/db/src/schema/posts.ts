import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { baseColumns } from './columns.js';

/**
 * News, announcements and stories for the website. `publish_at` is the whole publishing state:
 * null is a draft, a future time is scheduled, a past time is live. The body is plain text.
 */
export const posts = pgTable(
  'posts',
  {
    ...baseColumns(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    kind: text('kind').$type<'announcement' | 'news' | 'story'>().notNull().default('news'),
    summary: text('summary').notNull().default(''),
    body: text('body').notNull(),
    publishAt: timestamp('publish_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('posts_slug_key').on(t.slug),
    index('posts_publish_at_idx').on(t.publishAt.desc(), t.id.desc()),
    check('posts_kind_check', sql`${t.kind} in ('announcement', 'news', 'story')`),
    check('posts_body_length_check', sql`char_length(${t.body}) between 1 and 20000`),
    check('posts_slug_format_check', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
);
