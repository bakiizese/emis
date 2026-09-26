import { randomUUID } from 'node:crypto';

import {
  auditListResponseSchema,
  postListResponseSchema,
  postSchema,
  problemDetailsSchema,
  publicPostListResponseSchema,
  publicPostSchema,
} from '@emis/contracts';
import { createIsolatedDatabase, type TestDatabaseUrls } from '@emis/db/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createTestApp } from '../../testing/create-test-app.js';
import { callAs, createStaff } from '../../testing/staff-fixtures.js';

// Own database: turning the news module off is global.
let urls: TestDatabaseUrls;
let app: NestFastifyApplication;
let asAdmin: ReturnType<typeof callAs>;
let asCoordinator: ReturnType<typeof callAs>;
let asSecretary: ReturnType<typeof callAs>;
const anon = () => callAs(app, null);

const code = (res: LightMyRequestResponse) => problemDetailsSchema.parse(res.json()).code;
const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });
const key = () => ({ 'idempotency-key': randomUUID() });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let counter = 0;
async function draft(who = asCoordinator, overrides: Record<string, unknown> = {}) {
  const res = await who(
    'POST',
    '/posts',
    {
      title: `Post number ${++counter}`,
      body: 'First paragraph.\n\nSecond paragraph.',
      ...overrides,
    },
    key(),
  );
  expect(res.statusCode, res.body).toBe(201);
  return postSchema.parse(res.json());
}

async function publish(id: string, version: number, publishAt?: string) {
  const res = await asAdmin(
    'POST',
    `/posts/${id}/publish`,
    publishAt ? { publishAt } : {},
    ifMatch(version),
  );
  expect(res.statusCode, res.body).toBe(200);
  return postSchema.parse(res.json());
}

const publicList = async (query = '') =>
  publicPostListResponseSchema.parse((await anon()('GET', `/public/posts${query}`)).json());

beforeAll(async () => {
  urls = await createIsolatedDatabase(inject('database'), 'emis_posts_test');
  app = await createTestApp({ env: { DATABASE_URL: urls.appUrl, RATE_LIMIT_MAX: '100000' } });
  asAdmin = callAs(
    app,
    await createStaff(app, { email: 'posts-admin@lingua.test', roleKey: 'admin' }),
  );
  asCoordinator = callAs(
    app,
    await createStaff(app, { email: 'posts-coord@lingua.test', roleKey: 'coordinator' }),
  );
  asSecretary = callAs(
    app,
    await createStaff(app, { email: 'posts-desk@lingua.test', roleKey: 'secretary' }),
  );
});

afterAll(async () => {
  await app?.close();
});

describe('drafting', () => {
  it('starts as a draft nobody outside can see', async () => {
    const post = await draft(asCoordinator, {
      title: 'Evening classes open',
      kind: 'announcement',
    });
    expect(post).toMatchObject({
      status: 'draft',
      publishAt: null,
      slug: 'evening-classes-open',
      kind: 'announcement',
    });
    expect((await anon()('GET', `/public/posts/${post.slug}`)).statusCode).toBe(404);
    expect((await publicList()).items.map((p) => p.slug)).not.toContain(post.slug);
  });

  it('gives posts with the same title different addresses, even when created at once', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        asCoordinator('POST', '/posts', { title: 'Same headline', body: 'Text.' }, key()),
      ),
    );
    expect(results.every((r) => r.statusCode === 201)).toBe(true);
    const slugs = results.map((r) => postSchema.parse(r.json()).slug);
    expect(new Set(slugs).size).toBe(8);
    expect(slugs).toContain('same-headline');
    expect(slugs).toContain('same-headline-2');
  });

  it('gives a title with no Latin letters a usable address', async () => {
    expect((await draft(asCoordinator, { title: 'አዲስ ኮርስ ተከፈተ' })).slug).toMatch(/^post(-\d+)?$/);
  });

  it('refuses bad input', async () => {
    for (const bad of [
      { title: 'Hi', body: 'x' },
      { title: 'A fine title', body: '' },
      { title: 'A fine title', body: 'x'.repeat(20_001) },
      { title: 'A fine title', body: 'x', kind: 'gossip' },
      { title: 'A fine title', body: 'x', summary: 'y'.repeat(301) },
    ]) {
      expect((await asCoordinator('POST', '/posts', bad, key())).statusCode).toBe(400);
    }
  });

  it('replays a retried create instead of writing twice', async () => {
    const headers = key();
    const body = { title: 'Retry me', body: 'Text.' };
    const first = await asCoordinator('POST', '/posts', body, headers);
    const second = await asCoordinator('POST', '/posts', body, headers);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.json()).toEqual(first.json());
  });

  it('lets staff filter and search their list', async () => {
    const post = await draft(asCoordinator, { title: 'Findable zebra headline' });
    const res = await asSecretary('GET', '/posts?q=zebra&status=draft');
    expect(res.statusCode, res.body).toBe(200);
    expect(postListResponseSchema.parse(res.json()).items.map((p) => p.id)).toEqual([post.id]);
  });
});

describe('publishing', () => {
  it('is for publishers only', async () => {
    const post = await draft();
    const res = await asCoordinator('POST', `/posts/${post.id}/publish`, {}, ifMatch(post.version));
    expect(res.statusCode).toBe(403);
  });

  it('puts a post on the website with its body, and nothing private', async () => {
    const post = await draft(asCoordinator, { title: 'Now live', summary: 'Short version.' });
    const live = await publish(post.id, post.version);
    expect(live.status).toBe('published');

    const res = await anon()('GET', `/public/posts/${post.slug}`);
    expect(res.statusCode, res.body).toBe(200);
    const shown = publicPostSchema.parse(res.json());
    expect(shown).toMatchObject({ title: 'Now live', summary: 'Short version.' });
    expect(shown.body).toContain('Second paragraph.');
    for (const hidden of ['"id":', '"createdBy":', '"version":', '"publishAt":', '"status":']) {
      expect(res.body).not.toContain(hidden);
    }
    expect((await publicList()).items.map((p) => p.slug)).toContain(post.slug);
    expect(JSON.stringify(await publicList())).not.toContain('Second paragraph.');
  });

  it('treats a time in the past as "now"', async () => {
    const post = await draft();
    const before = Date.now();
    const live = await publish(post.id, post.version, '2020-01-01T00:00:00.000Z');
    expect(live.status).toBe('published');
    expect(new Date(live.publishAt ?? 0).getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('holds a scheduled post back until its time comes', async () => {
    const post = await draft();
    const at = new Date(Date.now() + 1500).toISOString();
    const scheduled = await publish(post.id, post.version, at);
    expect(scheduled.status).toBe('scheduled');
    expect((await anon()('GET', `/public/posts/${post.slug}`)).statusCode).toBe(404);
    expect((await publicList()).items.map((p) => p.slug)).not.toContain(post.slug);

    await sleep(1800);
    expect((await anon()('GET', `/public/posts/${post.slug}`)).statusCode).toBe(200);
    expect((await publicList()).items.map((p) => p.slug)).toContain(post.slug);
    const staffView = postSchema.parse((await asAdmin('GET', `/posts/${post.id}`)).json());
    expect(staffView.status).toBe('published');
  });

  it('takes a post back down', async () => {
    const post = await draft();
    const live = await publish(post.id, post.version);
    const res = await asAdmin(
      'POST',
      `/posts/${post.id}/unpublish`,
      undefined,
      ifMatch(live.version),
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(postSchema.parse(res.json()).status).toBe('draft');
    expect((await anon()('GET', `/public/posts/${post.slug}`)).statusCode).toBe(404);
  });

  it('refuses a stale version and a missing one', async () => {
    const post = await draft();
    const edited = await asCoordinator(
      'PATCH',
      `/posts/${post.id}`,
      { title: 'Edited title' },
      ifMatch(post.version),
    );
    expect(edited.statusCode, edited.body).toBe(200);

    const stale = await asAdmin('POST', `/posts/${post.id}/publish`, {}, ifMatch(post.version));
    expect(stale.statusCode).toBe(412);
    const missing = await asAdmin('POST', `/posts/${post.id}/publish`, {});
    expect(missing.statusCode).toBe(428);
  });

  it('keeps the address stable when the title is edited', async () => {
    const post = await draft(asCoordinator, { title: 'Original title' });
    const res = await asCoordinator(
      'PATCH',
      `/posts/${post.id}`,
      { title: 'Changed title' },
      ifMatch(post.version),
    );
    expect(postSchema.parse(res.json()).slug).toBe('original-title');
  });
});

describe('who may change what', () => {
  it('lets a drafter edit and delete their draft', async () => {
    const post = await draft();
    const edited = await asCoordinator(
      'PATCH',
      `/posts/${post.id}`,
      { summary: 'Better summary' },
      ifMatch(post.version),
    );
    expect(edited.statusCode, edited.body).toBe(200);
    expect((await asCoordinator('DELETE', `/posts/${post.id}`)).statusCode).toBe(204);
    expect((await asAdmin('GET', `/posts/${post.id}`)).statusCode).toBe(404);
  });

  it('keeps live and scheduled posts out of a drafter’s hands', async () => {
    const live = await publish((await draft()).id, 1);
    const scheduledDraft = await draft();
    const scheduled = await publish(
      scheduledDraft.id,
      scheduledDraft.version,
      new Date(Date.now() + 3_600_000).toISOString(),
    );

    for (const post of [live, scheduled]) {
      const edit = await asCoordinator(
        'PATCH',
        `/posts/${post.id}`,
        { title: 'Sneaky edit' },
        ifMatch(post.version),
      );
      expect(edit.statusCode).toBe(403);
      expect(code(edit)).toBe('POST_PUBLISH_RESTRICTED');
      const del = await asCoordinator('DELETE', `/posts/${post.id}`);
      expect(del.statusCode).toBe(403);
      expect((await asAdmin('GET', `/posts/${post.id}`)).statusCode).toBe(200);
    }
  });

  it('lets a publisher correct a live post and remove it', async () => {
    const live = await publish((await draft()).id, 1);
    const fix = await asAdmin(
      'PATCH',
      `/posts/${live.id}`,
      { body: 'Corrected text.' },
      ifMatch(live.version),
    );
    expect(fix.statusCode, fix.body).toBe(200);
    expect(
      publicPostSchema.parse((await anon()('GET', `/public/posts/${live.slug}`)).json()).body,
    ).toBe('Corrected text.');

    expect((await asAdmin('DELETE', `/posts/${live.id}`)).statusCode).toBe(204);
    expect((await anon()('GET', `/public/posts/${live.slug}`)).statusCode).toBe(404);
  });
});

describe('the public feed', () => {
  it('lists newest first and pages without repeats or gaps', async () => {
    const made: string[] = [];
    for (let n = 0; n < 5; n++) {
      const post = await draft(asCoordinator, {
        title: `Feed item ${n}`,
        kind: n % 2 ? 'story' : 'news',
      });
      made.push((await publish(post.id, post.version)).slug);
      await sleep(5);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await publicList(`?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...page.items.map((p) => p.slug));
      cursor = page.nextCursor;
    } while (cursor);

    const feed = seen.filter((s) => s.startsWith('feed-item'));
    expect(feed).toEqual([...made].reverse());
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('filters by kind', async () => {
    const { items } = await publicList('?kind=story&limit=50');
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((p) => p.kind === 'story')).toBe(true);
  });

  it('refuses a made-up cursor and an odd address', async () => {
    expect((await anon()('GET', '/public/posts?cursor=garbage')).statusCode).toBe(400);
    expect((await anon()('GET', '/public/posts/Not%20A%20Slug')).statusCode).toBe(400);
    expect((await anon()('GET', '/public/posts/does-not-exist')).statusCode).toBe(404);
  });
});

describe('audit and switches', () => {
  it('records changes without the text of the post', async () => {
    const post = await draft(asCoordinator, {
      title: 'Audited headline',
      body: 'Secret sentence inside.',
    });
    await publish(post.id, post.version);
    const res = await asAdmin('GET', '/audit-log?limit=100');
    const actions = auditListResponseSchema.parse(res.json()).items.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['post.created', 'post.published']));
    expect(res.body).not.toContain('Secret sentence inside.');
  });

  it('answers 404 everywhere while the news module is off', async () => {
    const setModule = (enabled: boolean) => asAdmin('PUT', '/modules/news', { enabled });
    expect((await setModule(false)).statusCode).toBe(200);
    expect((await asAdmin('GET', '/posts')).statusCode).toBe(404);
    expect((await anon()('GET', '/public/posts')).statusCode).toBe(404);
    expect((await anon()('GET', '/public/catalog')).statusCode).not.toBe(500);
    expect((await setModule(true)).statusCode).toBe(200);
    expect((await anon()('GET', '/public/posts')).statusCode).toBe(200);
  });
});
