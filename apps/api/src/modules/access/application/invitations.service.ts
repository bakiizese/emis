import type { InvitationDetails } from '@emis/contracts';
import { userAccounts, userInvitations } from '@emis/db';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';

import type { DbAdapter } from '../../../database/database.module.js';
import { AuditService } from '../../audit/index.js';
import { AccountsService, hashToken } from '../../identity/index.js';
import { accessErrors } from '../domain/errors.js';

@Injectable()
export class InvitationsService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly accounts: AccountsService,
    private readonly audit: AuditService,
  ) {}

  /** A still-usable invitation for an account that hasn't set a password yet. */
  private async findOpen(token: string) {
    const [row] = await this.txHost.tx
      .select({
        invitationId: userInvitations.id,
        expiresAt: userInvitations.expiresAt,
        userId: userAccounts.id,
        email: userAccounts.email,
        displayName: userAccounts.displayName,
      })
      .from(userInvitations)
      .innerJoin(userAccounts, eq(userAccounts.id, userInvitations.userId))
      .where(
        and(
          eq(userInvitations.tokenHash, hashToken(token)),
          isNull(userInvitations.acceptedAt),
          isNull(userInvitations.revokedAt),
          gt(userInvitations.expiresAt, new Date()),
          eq(userAccounts.status, 'active'),
          isNull(userAccounts.passwordHash),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async inspect(token: string): Promise<InvitationDetails> {
    const invitation = await this.findOpen(token);
    if (!invitation) throw accessErrors.invalidInvitation();
    return {
      email: invitation.email,
      displayName: invitation.displayName,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  /** Set the password and consume the invitation atomically: a link can't be used twice. */
  @Transactional()
  async accept(token: string, password: string): Promise<void> {
    const invitation = await this.findOpen(token);
    if (!invitation) throw accessErrors.invalidInvitation();

    const claimed = await this.txHost.tx
      .update(userInvitations)
      .set({ acceptedAt: new Date() })
      .where(
        and(eq(userInvitations.id, invitation.invitationId), isNull(userInvitations.acceptedAt)),
      )
      .returning({ id: userInvitations.id });
    if (claimed.length === 0) throw accessErrors.invalidInvitation();

    // Throws WEAK_PASSWORD, which rolls the claim back so the link still works.
    await this.accounts.setPassword(invitation.userId, password);
    await this.audit.record({
      action: 'user.invitation_accepted',
      entityType: 'user',
      entityId: invitation.userId,
      actor: { userId: invitation.userId, email: invitation.email },
    });
  }
}
