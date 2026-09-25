import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { idColumn } from './columns.js';

const tstz = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Responses of side-effecting requests, keyed by the client's Idempotency-Key. The row is written
 * in the same transaction as the request's own changes, so it exists if and only if they committed.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: idColumn(),
    /** Who sent it: a user id, or `anonymous` for public endpoints (keys must then be random UUIDs). */
    principal: text('principal').notNull(),
    key: text('key').notNull(),
    method: text('method').notNull(),
    path: text('path').notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: smallint('response_status').notNull(),
    responseBody: jsonb('response_body'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    expiresAt: tstz('expires_at').notNull(),
  },
  (t) => [
    uniqueIndex('idempotency_keys_principal_key_key').on(t.principal, t.key),
    index('idempotency_keys_expires_at_idx').on(t.expiresAt),
  ],
);

/**
 * Transactional outbox: events are inserted in the same transaction as the change that caused them,
 * then relayed to the job queue by the worker. Nothing is lost if the process dies in between, and
 * nothing is sent for a change that rolled back.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: idColumn(),
    type: text('type').notNull(),
    /** Sensitive payloads (emails with links, tokens) are stored encrypted: `{ sealed: "v1.…" }`. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    occurredAt: tstz('occurred_at').notNull().defaultNow(),
    availableAt: tstz('available_at').notNull().defaultNow(),
    correlationId: text('correlation_id'),
    actorUserId: uuid('actor_user_id'),
    publishedAt: tstz('published_at'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
  },
  (t) => [
    index('outbox_events_pending_idx')
      .on(t.availableAt, t.id)
      .where(sql`${t.publishedAt} is null`),
    index('outbox_events_published_at_idx').on(t.publishedAt),
  ],
);

/** Inbox: which consumer has already handled which event, so redelivered events run once. */
export const processedEvents = pgTable(
  'processed_events',
  {
    consumer: text('consumer').notNull(),
    eventId: uuid('event_id').notNull(),
    processedAt: tstz('processed_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.consumer, t.eventId] }),
    index('processed_events_processed_at_idx').on(t.processedAt),
  ],
);
