import { createHash } from 'node:crypto';

/** The hashed content of an audit row (everything except the DB-generated id/seq and the hashes). */
export interface AuditContent {
  occurredAt: string;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  changes: Record<string, unknown>;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

/** JSON with object keys sorted at every level: the same data always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** sha256(previous hash + canonical content). The first row chains from an empty string. */
export function chainHash(content: AuditContent, prevHash: string | null): string {
  return createHash('sha256')
    .update(prevHash ?? '')
    .update('\n')
    .update(canonicalJson(content))
    .digest('hex');
}
