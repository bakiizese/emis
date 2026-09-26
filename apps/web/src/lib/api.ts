import {
  defaultTerminology,
  type PublicCatalogResponse,
  type PublicClass,
  type PublicContact,
  type PublicCourseDetail,
  type PublicProfile,
  publicCatalogResponseSchema,
  publicClassListResponseSchema,
  publicContactSchema,
  publicCourseDetailSchema,
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

/** Never cached: a certificate can be revoked at any moment and the answer must be current. */
export const getVerification = (token: string): Promise<Verification> =>
  fetchJson(`/verify/${encodeURIComponent(token)}`, verificationSchema);

/** The institution's word for a thing, e.g. term(profile, 'cohort', true) → "Batches". */
export function term(profile: PublicProfile | null, key: TermKey, plural = false): string {
  const terms = profile?.terminology ?? defaultTerminology();
  return plural ? terms[key].plural : terms[key].singular;
}
