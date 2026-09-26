import { z } from 'zod';

export const POST_ERROR_CODES = {
  postNotFound: 'POST_NOT_FOUND',
  publishRestricted: 'POST_PUBLISH_RESTRICTED',
  notPublished: 'POST_NOT_PUBLISHED',
} as const;

export const POST_KINDS = ['announcement', 'news', 'story'] as const;
export const postKindSchema = z.enum(POST_KINDS);
export type PostKind = z.infer<typeof postKindSchema>;

/**
 * A post is a draft until it has a publish time, scheduled while that time is ahead, and published
 * once it has passed. There is no separate "state" to keep in step: the time decides.
 */
export const POST_STATUSES = ['draft', 'scheduled', 'published'] as const;
export const postStatusSchema = z.enum(POST_STATUSES);
export type PostStatus = z.infer<typeof postStatusSchema>;

export function postStatusAt(publishAt: string | Date | null, now: Date = new Date()): PostStatus {
  if (publishAt === null) return 'draft';
  return new Date(publishAt).getTime() > now.getTime() ? 'scheduled' : 'published';
}

export const POST_BODY_MAX = 20_000;

/** Plain text: a blank line starts a new paragraph. No markup is stored or rendered. */
export const postSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  kind: postKindSchema,
  summary: z.string(),
  body: z.string(),
  status: postStatusSchema,
  publishAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  version: z.number().int(),
});
export type Post = z.infer<typeof postSchema>;

const titleSchema = z.string().trim().min(3).max(150);
const summarySchema = z.string().trim().max(300);
const bodySchema = z.string().trim().min(1).max(POST_BODY_MAX);

export const createPostRequestSchema = z.object({
  title: titleSchema,
  kind: postKindSchema.default('news'),
  summary: summarySchema.default(''),
  body: bodySchema,
});
export type CreatePostRequest = z.input<typeof createPostRequestSchema>;
export type CreatePostValues = z.output<typeof createPostRequestSchema>;

export const updatePostRequestSchema = z
  .object({ title: titleSchema, kind: postKindSchema, summary: summarySchema, body: bodySchema })
  .partial();
export type UpdatePostRequest = z.input<typeof updatePostRequestSchema>;

/** Leave `publishAt` out to publish now; a time in the past also means now. */
export const publishPostRequestSchema = z.object({
  publishAt: z.iso.datetime().nullable().default(null),
});
export type PublishPostRequest = z.input<typeof publishPostRequestSchema>;
export type PublishPostValues = z.output<typeof publishPostRequestSchema>;

export const postListQuerySchema = z.object({
  status: postStatusSchema.optional(),
  kind: postKindSchema.optional(),
  q: z.string().trim().max(100).optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type PostListQuery = z.infer<typeof postListQuerySchema>;

export const postListResponseSchema = z.object({
  items: z.array(postSchema),
  nextCursor: z.string().nullable(),
});
export type PostListResponse = z.infer<typeof postListResponseSchema>;

// --- public ----------------------------------------------------------------------------------

/** What the website shows: no ids, no author, no drafts. */
export const publicPostSummarySchema = z.object({
  slug: z.string(),
  title: z.string(),
  kind: postKindSchema,
  summary: z.string(),
  publishedAt: z.iso.datetime(),
});
export type PublicPostSummary = z.infer<typeof publicPostSummarySchema>;

export const publicPostSchema = publicPostSummarySchema.extend({ body: z.string() });
export type PublicPost = z.infer<typeof publicPostSchema>;

export const publicPostListQuerySchema = z.object({
  kind: postKindSchema.optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});
export type PublicPostListQuery = z.infer<typeof publicPostListQuerySchema>;

export const publicPostListResponseSchema = z.object({
  items: z.array(publicPostSummarySchema),
  nextCursor: z.string().nullable(),
});
export type PublicPostListResponse = z.infer<typeof publicPostListResponseSchema>;
