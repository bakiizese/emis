import {
  defaultTerminology,
  type PublicCatalogResponse,
  type PublicClass,
  type PublicContact,
  type PublicCourseDetail,
  type PublicPost,
  type PublicPostListResponse,
  type PublicProfile,
  publicCatalogResponseSchema,
  publicClassListResponseSchema,
  publicContactSchema,
  publicCourseDetailSchema,
  publicPostListResponseSchema,
  publicPostSchema,
  publicProfileSchema,
  type TermKey,
  verificationSchema,
  type Verification,
} from '@emis/contracts';
import type { z } from 'zod';

import { TtlCache } from './cache';

// Server-side reads only: the browser talks to /api on this same origin (see next.config.ts).
const API_URL = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const cache = new TtlCache();

export class NotFoundError extends Error {
  constructor() {
    super('Not found');
    this.name = 'NotFoundError';
  }
}

async function fetchJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(`${API_URL}/api/v1${path}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
    headers: { accept: 'application/json' },
  });
  if (response.status === 404) throw new NotFoundError();
  if (!response.ok) throw new Error(`API ${response.status} for ${path}`);
  return schema.parse(await response.json());
}

const read = <T>(path: string, schema: z.ZodType<T>, ttlMs: number) =>
  cache.get(path, ttlMs, () => fetchJson(path, schema));

const MINUTE = 60_000;

export const getProfile = (): Promise<PublicProfile> =>
  read('/institution/public', publicProfileSchema, MINUTE);
export const getCatalog = (): Promise<PublicCatalogResponse> =>
  read('/public/catalog', publicCatalogResponseSchema, MINUTE);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const getCourse = (id: string): Promise<PublicCourseDetail> =>
  UUID.test(id)
    ? read(`/public/courses/${id}`, publicCourseDetailSchema, 30_000)
    : Promise.reject(new NotFoundError());
export const getUpcoming = async (limit = 6): Promise<PublicClass[]> =>
  (await read(`/public/classes?limit=${limit}`, publicClassListResponseSchema, 30_000)).items;
export const getContact = (): Promise<PublicContact> =>
  read('/public/contact', publicContactSchema, 5 * MINUTE);

export const getPosts = (
  options: { limit?: number; cursor?: string; kind?: string } = {},
): Promise<PublicPostListResponse> => {
  const query = new URLSearchParams({ limit: String(options.limit ?? 12) });
  if (options.cursor) query.set('cursor', options.cursor);
  if (options.kind) query.set('kind', options.kind);
  return read(`/public/posts?${query.toString()}`, publicPostListResponseSchema, 30_000);
};

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const getPost = (slug: string): Promise<PublicPost> =>
  SLUG.test(slug) && slug.length <= 80
    ? read(`/public/posts/${slug}`, publicPostSchema, 30_000)
    : Promise.reject(new NotFoundError());

/** Never cached: a certificate can be revoked at any moment and the answer must be current. */
export const getVerification = (token: string): Promise<Verification> =>
  fetchJson(`/verify/${encodeURIComponent(token)}`, verificationSchema);

/** The institution's word for a thing, e.g. term(profile, 'cohort', true) → "Batches". */
export function term(profile: PublicProfile | null, key: TermKey, plural = false): string {
  const terms = profile?.terminology ?? defaultTerminology();
  return plural ? terms[key].plural : terms[key].singular;
}
