import { z } from 'zod';

/**
 * Every API error is an RFC 9457 "problem details" document (`application/problem+json`).
 * `code` is stable and machine-readable; frontends switch on it, never on `detail`.
 */
export const problemFieldErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
  code: z.string(),
});

export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: z.string(),
  requestId: z.string().optional(),
  errors: z.array(problemFieldErrorSchema).optional(),
});

export type ProblemFieldError = z.infer<typeof problemFieldErrorSchema>;
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

/** Codes any endpoint may return. */
export const COMMON_ERROR_CODES = {
  /** The record changed since it was read (If-Match didn't match its version). Reload and retry. */
  versionConflict: 'VERSION_CONFLICT',
  /** Updates to versioned records need an `If-Match: "<version>"` header. */
  versionRequired: 'VERSION_REQUIRED',
} as const;
