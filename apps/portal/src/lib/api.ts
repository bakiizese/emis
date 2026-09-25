import { type ProblemFieldError, problemDetailsSchema } from '@emis/contracts';
import type { z } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors: ProblemFieldError[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Validates the response against the shared contract. */
  schema?: z.ZodType<T>;
  /** Makes a retried request safe: the API replays the first response instead of repeating the work. */
  idempotencyKey?: string;
}

/** Same-origin call to the EMIS API. Throws ApiError with the problem `code` on failure. */
export async function apiRequest<T = void>(
  path: string,
  options: RequestOptions<T> = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      "Can't reach the server. Check your connection and try again.",
    );
  }

  if (!response.ok) {
    const problem = problemDetailsSchema.safeParse(await response.json().catch(() => null));
    if (problem.success) {
      throw new ApiError(
        problem.data.status,
        problem.data.code,
        problem.data.detail ?? problem.data.title,
        problem.data.errors,
      );
    }
    throw new ApiError(response.status, 'UNKNOWN_ERROR', 'Something went wrong. Please try again.');
  }

  if (response.status === 204 || response.status === 202) return undefined as T;
  const json: unknown = await response.json();
  return options.schema ? options.schema.parse(json) : (json as T);
}

/** A sentence to show the user for any error thrown by apiRequest. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'RATE_LIMITED') return 'Too many attempts. Wait a minute and try again.';
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}
