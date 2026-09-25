import type { MyAccessResponse } from '@emis/contracts';
import { rolePermissions, roles, userRoleAssignments } from '@emis/db';
import { type Grant, isPermission, type Permission, type Scope } from '@emis/permissions';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import type { DbAdapter } from '../../../database/database.module.js';

export function toScope(type: 'global' | 'branch' | 'department', id: string | null): Scope {
  if (type === 'global' || id === null) return { type: 'global' };
  return { type, id };
}

@Injectable()
export class AccessService {
  constructor(private readonly txHost: TransactionHost<DbAdapter>) {}

  /** Every permission the person holds, at every scope they hold it. */
  async grantsFor(userId: string): Promise<Grant[]> {
    const rows = await this.txHost.tx
      .select({
        permission: rolePermissions.permission,
        scopeType: userRoleAssignments.scopeType,
        scopeId: userRoleAssignments.scopeId,
      })
      .from(userRoleAssignments)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoleAssignments.roleId))
      .where(eq(userRoleAssignments.userId, userId));

    return rows.flatMap((row) =>
      // Permissions removed from the catalog in code are ignored even if the DB still lists them.
      isPermission(row.permission)
        ? [{ permission: row.permission, scope: toScope(row.scopeType, row.scopeId) }]
        : [],
    );
  }

  async myAccess(userId: string): Promise<MyAccessResponse> {
    const assignments = await this.txHost.tx
      .select({
        key: roles.key,
        name: roles.name,
        scopeType: userRoleAssignments.scopeType,
        scopeId: userRoleAssignments.scopeId,
      })
      .from(userRoleAssignments)
      .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
      .where(eq(userRoleAssignments.userId, userId));
    const grants = await this.grantsFor(userId);

    return {
      roles: assignments.map((a) => ({
        key: a.key,
        name: a.name,
        scope: toScope(a.scopeType, a.scopeId),
      })),
      permissions: [...new Set<Permission>(grants.map((g) => g.permission))].sort(),
    };
  }
}
