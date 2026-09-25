import {
  bigint,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { idColumn } from './columns.js';

/**
 * Who changed what, and when. Append-only (the app role can't update or delete rows) and
 * hash-chained: each row's hash covers its content plus the previous row's hash, so editing or
 * removing any row breaks every hash after it. `seq` fixes the chain order.
 *
 * No foreign keys on purpose: history must survive deleted users, and an ON DELETE action would
 * rewrite rows and break the chain.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: idColumn(),
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity().notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    actorUserId: uuid('actor_user_id'),
    actorEmail: text('actor_email'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    changes: jsonb('changes').$type<Record<string, unknown>>().notNull().default({}),
    requestId: text('request_id'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    prevHash: text('prev_hash'),
    hash: text('hash').notNull(),
  },
  (t) => [
    uniqueIndex('audit_log_seq_key').on(t.seq),
    uniqueIndex('audit_log_hash_key').on(t.hash),
    index('audit_log_occurred_at_idx').on(t.occurredAt.desc()),
    index('audit_log_entity_idx').on(t.entityType, t.entityId),
    index('audit_log_actor_idx').on(t.actorUserId),
  ],
);
