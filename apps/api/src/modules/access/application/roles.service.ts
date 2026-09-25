import type { RoleSummary } from '@emis/contracts';
import { rolePermissions, roles } from '@emis/db';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';

import type { DbAdapter } from '../../../database/database.module.js';

type ScopeType = RoleSummary['allowedScopes'][number];

@Injectable()
export class RolesService {
  constructor(private readonly txHost: TransactionHost<DbAdapter>) {}

  async list(): Promise<RoleSummary[]> {
    const rows = await this.txHost.tx
      .select({ role: roles, permission: rolePermissions.permission })
      .from(roles)
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .orderBy(asc(roles.name));

    const byKey = new Map<string, RoleSummary>();
    for (const { role, permission } of rows) {
      const summary = byKey.get(role.key) ?? {
        key: role.key,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        mfaRequired: role.mfaRequired,
        allowedScopes: role.allowedScopes as ScopeType[],
        permissions: [],
      };
      if (permission) summary.permissions.push(permission);
      byKey.set(role.key, summary);
    }
    return [...byKey.values()];
  }

  async findByKey(key: string) {
    const [role] = await this.txHost.tx.select().from(roles).where(eq(roles.key, key)).limit(1);
    return role ?? null;
  }
}
