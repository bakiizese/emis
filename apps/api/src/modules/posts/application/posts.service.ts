import {
  type CreatePostValues,
  type Post,
  type PostListQuery,
  type PostListResponse,
  type PublicPost,
  type PublicPostListQuery,
  type PublicPostListResponse,
  postStatusAt,
  type PublishPostValues,
  type UpdatePostRequest,
} from '@emis/contracts';
import { afterCursor, decodeCursor, posts, toPage, updateWithVersion } from '@emis/db';
import { type Grant, hasPermission } from '@emis/permissions';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, isNotNull, isNull, like, lte, type SQL, sql } from 'drizzle-orm';

import { escapeLike } from '../../../common/db/like.js';
import { versionedRow } from '../../../common/http/versioning.js';
import type { Actor } from '../../../common/request/request-context.js';
import type { DbAdapter } from '../../../database/database.module.js';
import { AuditService } from '../../audit/index.js';
import { postErrors } from '../domain/errors.js';
import { slugify, uniqueSlug } from '../domain/slug.js';

type PostRow = typeof posts.$inferSelect;

const toPost = (row: PostRow): Post => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  kind: row.kind,
  summary: row.summary,
  body: row.body,
  status: postStatusAt(row.publishAt),
  publishAt: row.publishAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  version: row.version,
});

/**
 * News and announcements. A post's publishing state is just its `publish_at` time (null = draft,
 * ahead = scheduled, behind = live), so scheduling needs no background job and can't drift. People
 * who can only draft (`posts.manage`) may not touch a post that is live or scheduled.
 */
@Injectable()
export class PostsService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.txHost.tx;
  }

  // --- staff ---------------------------------------------------------------------------------

  async list(query: PostListQuery): Promise<PostListResponse> {
    const now = new Date();
    const conditions: (SQL | undefined)[] = [
      query.kind ? eq(posts.kind, query.kind) : undefined,
      query.status === 'draft' ? isNull(posts.publishAt) : undefined,
      query.status === 'scheduled' ? sql`${posts.publishAt} > ${now}` : undefined,
      query.status === 'published' ? lte(posts.publishAt, now) : undefined,
      query.q ? ilike(posts.title, `%${escapeLike(query.q)}%`) : undefined,
    ];
    if (query.cursor) {
      const [createdAt, id] = decodeCursor(query.cursor, 2);
      conditions.push(
        afterCursor([posts.createdAt, posts.id], [String(createdAt), String(id)], 'desc'),
      );
    }
    const rows = await this.db
      .select()
      .from(posts)
      .where(and(...conditions))
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(query.limit + 1);
    const page = toPage(rows, query.limit, (r) => [r.createdAt.toISOString(), r.id]);
    return { items: page.items.map(toPost), nextCursor: page.nextCursor };
  }

  private async row(id: string): Promise<PostRow> {
    const [row] = await this.db.select().from(posts).where(eq(posts.id, id));
    if (!row) throw postErrors.notFound();
    return row;
  }

  async get(id: string): Promise<Post> {
    return toPost(await this.row(id));
  }

  /** Only publishers may change or remove what the public can already see (or soon will). */
  private assertMayChange(row: PostRow, grants: readonly Grant[]): void {
    if (row.publishAt !== null && !hasPermission(grants, 'posts.publish')) {
      throw postErrors.publishRestricted();
    }
  }

  @Transactional()
  async create(input: CreatePostValues, actor: Actor): Promise<Post> {
    // One writer at a time picks a free slug; the unique index is the backstop.
    await this.db.execute(sql`SELECT pg_advisory_xact_lock(hashtext('emis.post_slug'))`);
    const base = slugify(input.title);
    const similar = await this.db
      .select({ slug: posts.slug })
      .from(posts)
      .where(like(posts.slug, `${escapeLike(base)}%`));
    const slug = uniqueSlug(base, new Set(similar.map((r) => r.slug)));

    const [row] = await this.db
      .insert(posts)
      .values({ ...input, slug, createdBy: actor.userId, updatedBy: actor.userId })
      .returning();
    if (!row) throw postErrors.notFound();
    await this.audit.record({
      action: 'post.created',
      entityType: 'post',
      entityId: row.id,
      changes: { slug, kind: row.kind },
    });
    return toPost(row);
  }

  @Transactional()
  async update(
    id: string,
    input: UpdatePostRequest,
    expectedVersion: number,
    grants: readonly Grant[],
    actor: Actor,
  ): Promise<Post> {
    this.assertMayChange(await this.row(id), grants);
    const row = versionedRow(
      await updateWithVersion(this.db, posts, id, expectedVersion, {
        ...input,
        updatedBy: actor.userId,
      }),
      postErrors.notFound,
    );
    await this.audit.record({
      action: 'post.updated',
      entityType: 'post',
      entityId: id,
      changes: {
        slug: row.slug,
        fields: Object.keys(input).filter((k) => input[k as keyof UpdatePostRequest] !== undefined),
      },
    });
    return toPost(row);
  }

  @Transactional()
  async publish(
    id: string,
    input: PublishPostValues,
    expectedVersion: number,
    actor: Actor,
  ): Promise<Post> {
    const now = new Date();
    const requested = input.publishAt ? new Date(input.publishAt) : null;
    const publishAt = requested && requested > now ? requested : now;
    const row = versionedRow(
      await updateWithVersion(this.db, posts, id, expectedVersion, {
        publishAt,
        updatedBy: actor.userId,
      }),
      postErrors.notFound,
    );
    await this.audit.record({
      action: publishAt > now ? 'post.scheduled' : 'post.published',
      entityType: 'post',
      entityId: id,
      changes: { slug: row.slug, publishAt: publishAt.toISOString() },
    });
    return toPost(row);
  }

  @Transactional()
  async unpublish(id: string, expectedVersion: number, actor: Actor): Promise<Post> {
    const row = versionedRow(
      await updateWithVersion(this.db, posts, id, expectedVersion, {
        publishAt: null,
        updatedBy: actor.userId,
      }),
      postErrors.notFound,
    );
    await this.audit.record({
      action: 'post.unpublished',
      entityType: 'post',
      entityId: id,
      changes: { slug: row.slug },
    });
    return toPost(row);
  }

  @Transactional()
  async remove(id: string, grants: readonly Grant[]): Promise<void> {
    const row = await this.row(id);
    this.assertMayChange(row, grants);
    await this.db.delete(posts).where(eq(posts.id, id));
    await this.audit.record({
      action: 'post.deleted',
      entityType: 'post',
      entityId: id,
      changes: { slug: row.slug },
    });
  }

  // --- public --------------------------------------------------------------------------------

  /** Live posts, newest first. Nothing scheduled or drafted ever appears. */
  async listPublished(query: PublicPostListQuery): Promise<PublicPostListResponse> {
    const now = new Date();
    const conditions: (SQL | undefined)[] = [
      isNotNull(posts.publishAt),
      lte(posts.publishAt, now),
      query.kind ? eq(posts.kind, query.kind) : undefined,
    ];
    if (query.cursor) {
      const [publishAt, id] = decodeCursor(query.cursor, 2);
      conditions.push(
        afterCursor([posts.publishAt, posts.id], [String(publishAt), String(id)], 'desc'),
      );
    }
    const rows = await this.db
      .select()
      .from(posts)
      .where(and(...conditions))
      .orderBy(desc(posts.publishAt), desc(posts.id))
      .limit(query.limit + 1);
    const page = toPage(rows, query.limit, (r) => [r.publishAt?.toISOString() ?? '', r.id]);
    return {
      items: page.items.map((r) => ({
        slug: r.slug,
        title: r.title,
        kind: r.kind,
        summary: r.summary,
        publishedAt: r.publishAt?.toISOString() ?? '',
      })),
      nextCursor: page.nextCursor,
    };
  }

  async getPublished(slug: string): Promise<PublicPost> {
    const [row] = await this.db
      .select()
      .from(posts)
      .where(
        and(eq(posts.slug, slug), isNotNull(posts.publishAt), lte(posts.publishAt, new Date())),
      );
    if (!row?.publishAt) throw postErrors.notFound();
    return {
      slug: row.slug,
      title: row.title,
      kind: row.kind,
      summary: row.summary,
      body: row.body,
      publishedAt: row.publishAt.toISOString(),
    };
  }
}
