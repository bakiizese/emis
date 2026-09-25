import { passwordResetTokens, userAccounts } from '@emis/db';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';

import { APP_CONFIG } from '../../../config/config.module.js';
import type { Env } from '../../../config/env.js';
import type { DbAdapter } from '../../../database/database.module.js';
import { EmailOutbox } from '../../../mail/email-outbox.service.js';
import { authErrors } from '../domain/errors.js';
import { PasswordPolicy } from '../domain/password-policy.js';
import { generateToken, hashToken } from '../domain/tokens.js';
import type { AuthContext, RequestContext } from '../domain/types.js';
import { PasswordHasher } from '../infrastructure/password-hasher.js';
import { AccountsService } from './accounts.service.js';
import { passwordChangedEmail, passwordResetEmail } from './mail-templates.js';
import { SecurityEventsService } from './security-events.service.js';
import { SessionsService } from './sessions.service.js';

export const RESET_TOKEN_TTL_MINUTES = 30;

@Injectable()
export class PasswordService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly accounts: AccountsService,
    private readonly sessions: SessionsService,
    private readonly hasher: PasswordHasher,
    private readonly policy: PasswordPolicy,
    private readonly events: SecurityEventsService,
    private readonly emails: EmailOutbox,
    @Inject(APP_CONFIG) private readonly env: Env,
  ) {}

  private get db() {
    return this.txHost.tx;
  }

  /**
   * Always succeeds from the caller's point of view, so it can't be used to discover accounts.
   * The email is queued in the same transaction and sent by the worker.
   */
  @Transactional()
  async requestReset(email: string, context: RequestContext): Promise<void> {
    const account = await this.accounts.findByEmail(email);
    if (!account || account.status !== 'active') {
      await this.events.record('password.reset_requested', context, {
        metadata: { matched: false },
      });
      return;
    }

    const token = generateToken();
    await this.issueToken(account.id, hashToken(token), context);
    await this.events.record('password.reset_requested', context, {
      userId: account.id,
      metadata: { matched: true },
    });

    // Token in the fragment: never sent to a server, so it can't leak through logs or Referer.
    const url = `${this.env.PORTAL_URL}/reset-password#token=${token}`;
    await this.emails.send(
      passwordResetEmail(account.email, this.env.APP_NAME, url, RESET_TOKEN_TTL_MINUTES),
    );
  }

  @Transactional()
  async resetPassword(token: string, password: string, context: RequestContext): Promise<void> {
    const [row] = await this.db
      .select({
        tokenId: passwordResetTokens.id,
        userId: userAccounts.id,
        email: userAccounts.email,
        displayName: userAccounts.displayName,
      })
      .from(passwordResetTokens)
      .innerJoin(userAccounts, eq(userAccounts.id, passwordResetTokens.userId))
      .where(
        and(
          eq(passwordResetTokens.tokenHash, hashToken(token)),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, new Date()),
          eq(userAccounts.status, 'active'),
        ),
      )
      .limit(1);
    if (!row) throw authErrors.invalidResetToken();

    const check = this.policy.check(password, [row.email, row.displayName]);
    if (!check.ok) throw authErrors.weakPassword(check.reason);
    const passwordHash = await this.hasher.hash(password);

    await this.applyReset(row.tokenId, row.userId, passwordHash, context);
    await this.emails.send(passwordChangedEmail(row.email, this.env.APP_NAME));
  }

  /** Change while signed in: other sessions end, this one continues with a fresh token. */
  @Transactional()
  async changePassword(
    auth: AuthContext,
    input: { currentPassword: string; newPassword: string },
    context: RequestContext,
  ): Promise<string> {
    const account = await this.accounts.findById(auth.userId);
    if (!account || !(await this.hasher.verify(account.passwordHash, input.currentPassword))) {
      throw authErrors.invalidCurrentPassword();
    }
    const check = this.policy.check(input.newPassword, [account.email, account.displayName]);
    if (!check.ok) throw authErrors.weakPassword(check.reason);
    const passwordHash = await this.hasher.hash(input.newPassword);

    const token = await this.applyChange(auth, passwordHash, context);
    await this.emails.send(passwordChangedEmail(account.email, this.env.APP_NAME));
    return token;
  }

  @Transactional()
  private async issueToken(
    userId: string,
    tokenHash: string,
    context: RequestContext,
  ): Promise<void> {
    const now = new Date();
    // Only the newest link works.
    await this.db
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)));
    await this.db.insert(passwordResetTokens).values({
      userId,
      tokenHash,
      expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MINUTES * 60_000),
      requestedIp: context.ip,
    });
  }

  @Transactional()
  private async applyReset(
    tokenId: string,
    userId: string,
    passwordHash: string,
    context: RequestContext,
  ): Promise<void> {
    // Claim the token atomically: two concurrent resets with the same link can't both succeed.
    const claimed = await this.db
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.id, tokenId), isNull(passwordResetTokens.usedAt)))
      .returning({ id: passwordResetTokens.id });
    if (claimed.length === 0) throw authErrors.invalidResetToken();

    await this.db
      .update(userAccounts)
      .set({ passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null })
      .where(eq(userAccounts.id, userId));
    const revoked = await this.sessions.revokeAllForUser(userId, 'password_reset');
    await this.events.record('password.reset', context, {
      userId,
      metadata: { sessionsRevoked: revoked },
    });
  }

  @Transactional()
  private async applyChange(
    auth: AuthContext,
    passwordHash: string,
    context: RequestContext,
  ): Promise<string> {
    await this.db
      .update(userAccounts)
      .set({ passwordHash, passwordChangedAt: new Date() })
      .where(eq(userAccounts.id, auth.userId));
    const revoked = await this.sessions.revokeAllForUser(
      auth.userId,
      'password_changed',
      auth.sessionId,
    );
    const token = await this.sessions.rotate(auth.sessionId, { markMfaVerified: false });
    await this.events.record('password.changed', context, {
      userId: auth.userId,
      metadata: { sessionsRevoked: revoked },
    });
    return token;
  }
}
