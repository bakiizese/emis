import type {
  RoleAssignment,
  StaffListQuery,
  StaffListResponse,
  StaffStatus,
  StaffUser,
} from '@emis/contracts';
import {
  afterCursor,
  decodeCursor,
  roles,
  toPage,
  userAccounts,
  userInvitations,
  userRoleAssignments,
  userTotpFactors,
} from '@emis/db';
import type { Scope } from '@emis/permissions';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';

import type { Actor } from '../../../common/request/request-context.js';
import { APP_CONFIG } from '../../../config/config.module.js';
import type { Env } from '../../../config/env.js';
import type { DbAdapter } from '../../../database/database.module.js';
import { EmailOutbox } from '../../../mail/email-outbox.service.js';
import { AuditService } from '../../audit/index.js';
import {
  AccountsService,
  generateToken,
  hashToken,
  SessionsService,
} from '../../identity/index.js';
import { accessErrors } from '../domain/errors.js';
import { ScopeResolver } from '../domain/scope-resolver.js';
import { toScope } from './access.service.js';
import { invitationEmail } from './mail-templates.js';
import { RolesService } from './roles.service.js';

export const INVITATION_TTL_HOURS = 72;
const ADMIN_ROLE = 'admin';

function isUniqueViolation(error: unknown): boolean {
  const code = (e: unknown) =>
    typeof e === 'object' && e !== null && 'code' in e ? e.code : undefined;
  return code(error) === '23505' || code((error as { cause?: unknown }).cause) === '23505';
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

@Injectable()
export class UsersService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly accounts: AccountsService,
    private readonly sessions: SessionsService,
    private readonly roles: RolesService,
    private readonly scopes: ScopeResolver,
    private readonly audit: AuditService,
    private readonly emails: EmailOutbox,
    @Inject(APP_CONFIG) private readonly env: Env,
  ) {}

  private get db() {
    return this.txHost.tx;
  }

  async list(query: StaffListQuery): Promise<StaffListResponse> {
    const conditions = [];
    if (query.q) {
      const pattern = `%${escapeLike(query.q)}%`;
      conditions.push(
        or(ilike(userAccounts.email, pattern), ilike(userAccounts.displayName, pattern)),
      );
    }
    if (query.cursor) {
      const [createdAt, id] = decodeCursor(query.cursor, 2);
      conditions.push(
        afterCursor(
          [userAccounts.createdAt, userAccounts.id],
          [String(createdAt), String(id)],
          'desc',
        ),
      );
    }

    const rows = await this.db
      .select({ id: userAccounts.id, createdAt: userAccounts.createdAt })
      .from(userAccounts)
      .where(and(...conditions))
      .orderBy(desc(userAccounts.createdAt), desc(userAccounts.id))
      .limit(query.limit + 1);

    const page = toPage(rows, query.limit, (r) => [r.createdAt.toISOString(), r.id]);
    const users = await this.load(page.items.map((r) => r.id));
    return { items: page.items.flatMap((r) => users.get(r.id) ?? []), nextCursor: page.nextCursor };
  }

  async get(userId: string): Promise<StaffUser> {
    const user = (await this.load([userId])).get(userId);
    if (!user) throw accessErrors.userNotFound();
    return user;
  }

  /** Create the account, grant the role and queue an email with a single-use link, all in one transaction. */
  @Transactional()
  async invite(
    input: { email: string; displayName: string; roleKey: string; scope: Scope },
    inviter: Actor & { displayName: string },
  ): Promise<StaffUser> {
    const role = await this.requireGrantableRole(input.roleKey, input.scope);
    const { userId, token } = await this.createInvited(input, role, inviter);
    await this.queueInvitation({
      email: input.email,
      displayName: input.displayName,
      roleName: role.name,
      token,
      inviter,
    });
    return this.get(userId);
  }

  @Transactional()
  async resendInvitation(userId: string, inviter: Actor & { displayName: string }): Promise<void> {
    const user = await this.get(userId);
    if (user.status !== 'invited') throw accessErrors.alreadyActivated();
    const token = await this.reissueInvitation(userId, inviter);
    await this.queueInvitation({
      email: user.email,
      displayName: user.displayName,
      roleName: user.roles[0]?.roleName ?? 'staff',
      token,
      inviter,
    });
  }

  @Transactional()
  async setStatus(userId: string, status: 'active' | 'disabled', actor: Actor): Promise<StaffUser> {
    if (userId === actor.userId) throw accessErrors.cannotChangeSelf();
    const before = await this.get(userId);
    if (status === 'disabled' && before.roles.some((r) => r.roleKey === ADMIN_ROLE)) {
      await this.assertAnotherAdmin(userId);
    }

    await this.accounts.setStatus(userId, status);
    let sessionsRevoked = 0;
    if (status === 'disabled')
      sessionsRevoked = await this.sessions.revokeAllForUser(userId, 'account_disabled');

    await this.audit.record({
      action: status === 'disabled' ? 'user.disabled' : 'user.enabled',
      entityType: 'user',
      entityId: userId,
      changes: { status: { from: before.status, to: status }, sessionsRevoked },
    });
    return this.get(userId);
  }

  @Transactional()
  async assignRole(
    userId: string,
    input: { roleKey: string; scope: Scope },
    actor: Actor,
  ): Promise<StaffUser> {
    await this.get(userId);
    const role = await this.requireGrantableRole(input.roleKey, input.scope);

    try {
      await this.db.insert(userRoleAssignments).values({
        userId,
        roleId: role.id,
        scopeType: input.scope.type,
        scopeId: input.scope.type === 'global' ? null : input.scope.id,
        grantedBy: actor.userId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw accessErrors.roleAlreadyAssigned();
      throw error;
    }
    if (role.mfaRequired) await this.accounts.enforceMfa(userId);

    await this.audit.record({
      action: 'role.assigned',
      entityType: 'user',
      entityId: userId,
      changes: { role: role.key, scope: input.scope, mfaEnforced: role.mfaRequired || undefined },
    });
    return this.get(userId);
  }

  @Transactional()
  async removeAssignment(userId: string, assignmentId: string): Promise<StaffUser> {
    const [assignment] = await this.db
      .select({
        id: userRoleAssignments.id,
        roleKey: roles.key,
        scopeType: userRoleAssignments.scopeType,
        scopeId: userRoleAssignments.scopeId,
      })
      .from(userRoleAssignments)
      .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
      .where(and(eq(userRoleAssignments.id, assignmentId), eq(userRoleAssignments.userId, userId)));
    if (!assignment) throw accessErrors.assignmentNotFound();
    if (assignment.roleKey === ADMIN_ROLE) await this.assertAnotherAdmin(userId);

    await this.db.delete(userRoleAssignments).where(eq(userRoleAssignments.id, assignmentId));
    await this.audit.record({
      action: 'role.removed',
      entityType: 'user',
      entityId: userId,
      changes: {
        role: assignment.roleKey,
        scope: toScope(assignment.scopeType, assignment.scopeId),
      },
    });
    return this.get(userId);
  }

  // --- internals -------------------------------------------------------------------------------

  private async requireGrantableRole(roleKey: string, scope: Scope) {
    const role = await this.roles.findByKey(roleKey);
    if (!role) throw accessErrors.roleNotFound();
    if (!role.allowedScopes.includes(scope.type)) throw accessErrors.scopeNotAllowed(role.name);
    if (!(await this.scopes.exists(scope))) throw accessErrors.scopeNotAvailable();
    return role;
  }

  @Transactional()
  private async createInvited(
    input: { email: string; displayName: string; scope: Scope },
    role: { id: string; key: string; mfaRequired: boolean },
    inviter: Actor,
  ): Promise<{ userId: string; token: string }> {
    const { id: userId } = await this.accounts.create({
      email: input.email,
      displayName: input.displayName,
      mfaEnforced: role.mfaRequired,
    });
    await this.db.insert(userRoleAssignments).values({
      userId,
      roleId: role.id,
      scopeType: input.scope.type,
      scopeId: input.scope.type === 'global' ? null : input.scope.id,
      grantedBy: inviter.userId,
    });
    const token = await this.issueInvitationToken(userId, inviter.userId);
    await this.audit.record({
      action: 'user.invited',
      entityType: 'user',
      entityId: userId,
      changes: { email: input.email, role: role.key, scope: input.scope },
    });
    return { userId, token };
  }

  @Transactional()
  private async reissueInvitation(userId: string, inviter: Actor): Promise<string> {
    await this.db
      .update(userInvitations)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(userInvitations.userId, userId),
          isNull(userInvitations.acceptedAt),
          isNull(userInvitations.revokedAt),
        ),
      );
    const token = await this.issueInvitationToken(userId, inviter.userId);
    await this.audit.record({
      action: 'user.invitation_resent',
      entityType: 'user',
      entityId: userId,
    });
    return token;
  }

  private async issueInvitationToken(userId: string, invitedBy: string): Promise<string> {
    const token = generateToken();
    await this.db.insert(userInvitations).values({
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + INVITATION_TTL_HOURS * 3_600_000),
      invitedBy,
    });
    return token;
  }

  private queueInvitation(input: {
    email: string;
    displayName: string;
    roleName: string;
    token: string;
    inviter: { displayName: string };
  }): Promise<void> {
    return this.emails.send(
      invitationEmail({
        to: input.email,
        displayName: input.displayName,
        inviterName: input.inviter.displayName,
        roleName: input.roleName,
        appName: this.env.APP_NAME,
        url: `${this.env.PORTAL_URL}/accept-invite#token=${input.token}`,
        hours: INVITATION_TTL_HOURS,
      }),
    );
  }

  /**
   * Refuse to remove the last active admin. Serialized with an advisory lock so two admins
   * demoting each other at the same moment can't both succeed.
   */
  private async assertAnotherAdmin(excludingUserId: string): Promise<void> {
    await this.db.execute(sql`SELECT pg_advisory_xact_lock(hashtext('emis.admin_guard'))`);
    const [row] = await this.db
      .select({ count: sql<number>`count(distinct ${userRoleAssignments.userId})::int` })
      .from(userRoleAssignments)
      .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
      .innerJoin(userAccounts, eq(userAccounts.id, userRoleAssignments.userId))
      .where(
        and(
          eq(roles.key, ADMIN_ROLE),
          eq(userAccounts.status, 'active'),
          isNotNull(userAccounts.passwordHash),
          ne(userRoleAssignments.userId, excludingUserId),
        ),
      );
    if ((row?.count ?? 0) === 0) throw accessErrors.lastAdmin();
  }

  /** Staff users with their roles and MFA state, keyed by id. */
  private async load(ids: string[]): Promise<Map<string, StaffUser>> {
    if (ids.length === 0) return new Map();
    const [accounts, assignments] = await Promise.all([
      this.db
        .select({ account: userAccounts, factorConfirmedAt: userTotpFactors.confirmedAt })
        .from(userAccounts)
        .leftJoin(userTotpFactors, eq(userTotpFactors.userId, userAccounts.id))
        .where(inArray(userAccounts.id, ids)),
      this.db
        .select({
          id: userRoleAssignments.id,
          userId: userRoleAssignments.userId,
          roleKey: roles.key,
          roleName: roles.name,
          scopeType: userRoleAssignments.scopeType,
          scopeId: userRoleAssignments.scopeId,
        })
        .from(userRoleAssignments)
        .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
        .where(inArray(userRoleAssignments.userId, ids)),
    ]);

    const rolesByUser = new Map<string, RoleAssignment[]>();
    for (const a of assignments) {
      const list = rolesByUser.get(a.userId) ?? [];
      list.push({
        id: a.id,
        roleKey: a.roleKey,
        roleName: a.roleName,
        scope: toScope(a.scopeType, a.scopeId),
      });
      rolesByUser.set(a.userId, list);
    }

    return new Map(
      accounts.map(({ account, factorConfirmedAt }) => {
        const status: StaffStatus =
          account.status === 'disabled'
            ? 'disabled'
            : account.passwordHash === null
              ? 'invited'
              : 'active';
        return [
          account.id,
          {
            id: account.id,
            email: account.email,
            displayName: account.displayName,
            status,
            mfaEnabled: factorConfirmedAt !== null,
            mfaEnforced: account.mfaEnforced,
            lastLoginAt: account.lastLoginAt?.toISOString() ?? null,
            createdAt: account.createdAt.toISOString(),
            roles: rolesByUser.get(account.id) ?? [],
          },
        ];
      }),
    );
  }
}
