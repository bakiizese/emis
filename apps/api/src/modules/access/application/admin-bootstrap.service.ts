import { emailSchema } from '@emis/contracts';
import { roles, userRoleAssignments } from '@emis/db';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import type { DbAdapter } from '../../../database/database.module.js';
import { AuditService } from '../../audit/index.js';
import { AccountsService } from '../../identity/index.js';

/**
 * Server-side way to get an admin into a fresh (or locked-out) install: creates the account if
 * needed, grants the global Admin role and enforces two-factor. Used by the CLI only.
 */
@Injectable()
export class AdminBootstrapService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly accounts: AccountsService,
    private readonly audit: AuditService,
  ) {}

  findExisting(email: string) {
    return this.accounts.findByEmail(emailSchema.parse(email));
  }

  @Transactional()
  async ensureAdmin(input: {
    email: string;
    displayName: string;
    password?: string;
  }): Promise<{ userId: string; created: boolean }> {
    const existing = await this.findExisting(input.email);
    const userId =
      existing?.id ??
      (
        await this.accounts.create({
          email: input.email,
          displayName: input.displayName,
          password: input.password,
          mfaEnforced: true,
        })
      ).id;

    const [adminRole] = await this.txHost.tx
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, 'admin'));
    if (!adminRole) throw new Error('Admin role missing: run `pnpm db:migrate` first.');

    await this.txHost.tx
      .insert(userRoleAssignments)
      .values({ userId, roleId: adminRole.id, scopeType: 'global' })
      .onConflictDoNothing();
    await this.accounts.enforceMfa(userId);
    await this.audit.record({
      action: existing ? 'admin.granted_by_cli' : 'admin.created_by_cli',
      entityType: 'user',
      entityId: userId,
      changes: { email: emailSchema.parse(input.email) },
    });
    return { userId, created: !existing };
  }
}
