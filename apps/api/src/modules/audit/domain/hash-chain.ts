import { createHash } from 'node:crypto';

import { canonicalJson } from '../../../common/json/canonical-json.js';

export { canonicalJson };

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

/** sha256(previous hash + canonical content). The first row chains from an empty string. */
export function chainHash(content: AuditContent, prevHash: string | null): string {
  return createHash('sha256')
    .update(prevHash ?? '')
    .update('\n')
    .update(canonicalJson(content))
    .digest('hex');
}
