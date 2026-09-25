import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

// Only trust well-formed incoming ids, so a client can't inject arbitrary text into our logs.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

/** Reuse the caller's (e.g. Caddy's) request id when it is safe, otherwise mint a UUID. */
export function resolveRequestId(request: IncomingMessage): string {
  const incoming = request.headers[REQUEST_ID_HEADER];
  return typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
}
