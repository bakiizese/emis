import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { baseColumns, idColumn } from './columns.js';
import { userAccounts } from './identity.js';

const tstz = (name: string) => timestamp(name, { withTimezone: true });

/** System roles (admin, coordinator, …) are synced from code at startup; custom roles are data. */
export const roles = pgTable(
  'roles',
  {
    ...baseColumns(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    isSystem: boolean('is_system').notNull().default(false),
    mfaRequired: boolean('mfa_required').notNull().default(false),
    /** Scope types this role may be granted at: global, branch, department. */
    allowedScopes: text('allowed_scopes')
      .array()
      .notNull()
      .default(sql`ARRAY['global']::text[]`),
  },
  (t) => [uniqueIndex('roles_key_key').on(t.key)],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permission: text('permission').notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permission] })],
);

export const SCOPE_TYPE_VALUES = ['global', 'branch', 'department'] as const;

/** A role granted to a person at a scope: the whole institution, one branch or one department. */
export const userRoleAssignments = pgTable(
  'user_role_assignments',
  {
    id: idColumn(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userAccounts.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    scopeType: text('scope_type').$type<(typeof SCOPE_TYPE_VALUES)[number]>().notNull(),
    /** Branch or department id; null for global. */
    scopeId: uuid('scope_id'),
    grantedBy: uuid('granted_by').references(() => userAccounts.id, { onDelete: 'set null' }),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('user_role_assignments_unique')
      .on(t.userId, t.roleId, t.scopeType, t.scopeId)
      .nullsNotDistinct(),
    index('user_role_assignments_user_id_idx').on(t.userId),
    check(
      'user_role_assignments_scope_type_check',
      sql`${t.scopeType} in ('global', 'branch', 'department')`,
    ),
    check(
      'user_role_assignments_scope_id_check',
      sql`(${t.scopeType} = 'global') = (${t.scopeId} is null)`,
    ),
  ],
);

/** Single-use link that lets an invited staff member set their password. */
export const userInvitations = pgTable(
  'user_invitations',
  {
    id: idColumn(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userAccounts.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: tstz('expires_at').notNull(),
    acceptedAt: tstz('accepted_at'),
    revokedAt: tstz('revoked_at'),
    invitedBy: uuid('invited_by').references(() => userAccounts.id, { onDelete: 'set null' }),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('user_invitations_token_hash_key').on(t.tokenHash),
    index('user_invitations_user_id_idx').on(t.userId),
  ],
);
