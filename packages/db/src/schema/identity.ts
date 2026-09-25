import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { baseColumns, idColumn, timestampColumns } from './columns.js';
import { citext } from './types.js';

const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const ACCOUNT_STATUSES = ['active', 'disabled'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const userAccounts = pgTable(
  'user_accounts',
  {
    ...baseColumns(),
    email: citext('email').notNull(),
    displayName: text('display_name').notNull(),
    /** Argon2id PHC string. Null until the person sets a password (e.g. invited staff). */
    passwordHash: text('password_hash'),
    status: text('status').$type<AccountStatus>().notNull().default('active'),
    /** Policy: this account must use MFA (always true for admins). */
    mfaEnforced: boolean('mfa_enforced').notNull().default(false),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: tstz('locked_until'),
    lastLoginAt: tstz('last_login_at'),
    passwordChangedAt: tstz('password_changed_at'),
  },
  (t) => [
    uniqueIndex('user_accounts_email_key').on(t.email),
    check('user_accounts_status_check', sql`${t.status} in ('active', 'disabled')`),
    check('user_accounts_failed_login_count_check', sql`${t.failedLoginCount} >= 0`),
  ],
);

/** Server-side sessions. The cookie holds a random token; only its SHA-256 is stored. */
export const userSessions = pgTable(
  'user_sessions',
  {
    id: idColumn(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userAccounts.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
    lastSeenAt: tstz('last_seen_at').notNull().defaultNow(),
    idleExpiresAt: tstz('idle_expires_at').notNull(),
    absoluteExpiresAt: tstz('absolute_expires_at').notNull(),
    /** Set once the second factor passed; null while MFA is pending (or not required). */
    mfaVerifiedAt: tstz('mfa_verified_at'),
    mfaFailedAttempts: smallint('mfa_failed_attempts').notNull().default(0),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    revokedAt: tstz('revoked_at'),
    revokedReason: text('revoked_reason'),
  },
  (t) => [
    uniqueIndex('user_sessions_token_hash_key').on(t.tokenHash),
    index('user_sessions_user_id_idx').on(t.userId),
  ],
);

/** One TOTP authenticator per account. The secret is encrypted (AES-256-GCM) by the API. */
export const userTotpFactors = pgTable(
  'user_totp_factors',
  {
    id: idColumn(),
    ...timestampColumns(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userAccounts.id, { onDelete: 'cascade' }),
    secretCiphertext: text('secret_ciphertext').notNull(),
    confirmedAt: tstz('confirmed_at'),
    /** Highest TOTP time step already accepted: codes at or before it are replays. */
    lastUsedTimeStep: bigint('last_used_time_step', { mode: 'number' }),
  },
  (t) => [uniqueIndex('user_totp_factors_user_id_key').on(t.userId)],
);

/** Single-use MFA recovery codes (SHA-256; the codes themselves are high-entropy). */
export const userRecoveryCodes = pgTable(
  'user_recovery_codes',
  {
    id: idColumn(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userAccounts.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: tstz('used_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('user_recovery_codes_user_code_key').on(t.userId, t.codeHash)],
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: idColumn(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userAccounts.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: tstz('expires_at').notNull(),
    usedAt: tstz('used_at'),
    requestedIp: text('requested_ip'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('password_reset_tokens_token_hash_key').on(t.tokenHash),
    index('password_reset_tokens_user_id_idx').on(t.userId),
  ],
);

/** Append-only log of authentication events. The app role can insert but never update or delete. */
export const securityEvents = pgTable(
  'security_events',
  {
    id: idColumn(),
    occurredAt: tstz('occurred_at').notNull().defaultNow(),
    userId: uuid('user_id').references(() => userAccounts.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index('security_events_user_id_occurred_at_idx').on(t.userId, t.occurredAt.desc()),
    index('security_events_type_occurred_at_idx').on(t.type, t.occurredAt.desc()),
  ],
);
