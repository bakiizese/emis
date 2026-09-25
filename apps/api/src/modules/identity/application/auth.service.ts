import type { LoginRequest, LoginResponse, MeResponse } from '@emis/contracts';
import { userAccounts, userTotpFactors } from '@emis/db';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNotNull, sql } from 'drizzle-orm';

import { APP_CONFIG } from '../../../config/config.module.js';
import type { Env } from '../../../config/env.js';
import type { DbAdapter } from '../../../database/database.module.js';
import { MAILER, type Mailer } from '../../../mail/mailer.js';
import { authErrors } from '../domain/errors.js';
import { type AuthContext, nextStepFor, type RequestContext } from '../domain/types.js';
import { PasswordHasher } from '../infrastructure/password-hasher.js';
import { AccountsService } from './accounts.service.js';
import { accountLockedEmail } from './mail-templates.js';
import { SecurityEventsService } from './security-events.service.js';
import { SessionsService } from './sessions.service.js';

/** Failures before the first lockout; each lockout after that doubles, capped at an hour. */
export const LOCKOUT_THRESHOLD = 5;
const MAX_LOCKOUT_MINUTES = 60;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly accounts: AccountsService,
    private readonly sessions: SessionsService,
    private readonly hasher: PasswordHasher,
    private readonly events: SecurityEventsService,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(APP_CONFIG) private readonly env: Env,
  ) {}

  async login(
    input: LoginRequest,
    context: RequestContext,
  ): Promise<{ token: string; response: LoginResponse }> {
    const account = await this.accounts.findByEmail(input.email);
    const now = new Date();

    const usable = account && account.status === 'active' && account.passwordHash !== null;
    const locked = account?.lockedUntil != null && account.lockedUntil > now;

    if (!usable || locked) {
      // Same work and same answer as a wrong password: nothing to learn about the account.
      await this.hasher.verify(null, input.password);
      await this.events.record(locked ? 'login.blocked' : 'login.failed', context, {
        userId: account?.id ?? null,
        metadata: { reason: locked ? 'locked' : account ? 'unusable_account' : 'unknown_email' },
      });
      throw authErrors.invalidCredentials();
    }

    if (!(await this.hasher.verify(account.passwordHash, input.password))) {
      const failure = await this.registerFailure(account.id);
      await this.events.record('login.failed', context, {
        userId: account.id,
        metadata: { reason: 'wrong_password', failedAttempts: failure.count },
      });
      if (failure.lockedUntil && failure.count % LOCKOUT_THRESHOLD === 0) {
        await this.events.record('account.locked', context, {
          userId: account.id,
          metadata: { until: failure.lockedUntil.toISOString() },
        });
        this.sendInBackground(
          accountLockedEmail(account.email, this.env.APP_NAME, failure.lockedUntil),
        );
      }
      throw authErrors.invalidCredentials();
    }

    const passwordHash = account.passwordHash;
    await this.txHost.tx
      .update(userAccounts)
      .set({
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: now,
        ...(passwordHash && this.hasher.needsRehash(passwordHash)
          ? { passwordHash: await this.hasher.hash(input.password) }
          : {}),
      })
      .where(eq(userAccounts.id, account.id));

    const mfaEnabled = await this.hasConfirmedFactor(account.id);
    const { token } = await this.sessions.create(account.id, context, { mfaVerified: false });
    await this.events.record('login.succeeded', context, { userId: account.id });

    return {
      token,
      response: {
        user: { id: account.id, email: account.email, displayName: account.displayName },
        nextStep: nextStepFor({ mfaEnabled, mfaEnforced: account.mfaEnforced, mfaVerified: false }),
      },
    };
  }

  async logout(auth: AuthContext, context: RequestContext): Promise<void> {
    await this.sessions.revoke(auth.sessionId, 'logout');
    await this.events.record('logout', context, { userId: auth.userId });
  }

  me(auth: AuthContext): MeResponse {
    return {
      user: {
        id: auth.userId,
        email: auth.email,
        displayName: auth.displayName,
        mfaEnabled: auth.mfaEnabled,
        mfaEnforced: auth.mfaEnforced,
      },
      session: {
        id: auth.sessionId,
        createdAt: auth.sessionCreatedAt.toISOString(),
        expiresAt: auth.absoluteExpiresAt.toISOString(),
        mfaVerified: auth.mfaVerified,
      },
      nextStep: auth.nextStep,
    };
  }

  private async hasConfirmedFactor(userId: string): Promise<boolean> {
    const [factor] = await this.txHost.tx
      .select({ id: userTotpFactors.id })
      .from(userTotpFactors)
      .where(and(eq(userTotpFactors.userId, userId), isNotNull(userTotpFactors.confirmedAt)))
      .limit(1);
    return factor !== undefined;
  }

  /** Atomically count a failure and lock the account at every LOCKOUT_THRESHOLD failures. */
  private async registerFailure(
    userId: string,
  ): Promise<{ count: number; lockedUntil: Date | null }> {
    const next = sql`${userAccounts.failedLoginCount} + 1`;
    const [row] = await this.txHost.tx
      .update(userAccounts)
      .set({
        failedLoginCount: next,
        lockedUntil: sql`CASE WHEN ${next} >= ${LOCKOUT_THRESHOLD}
          THEN now() + make_interval(mins => LEAST(${MAX_LOCKOUT_MINUTES}, power(2, ${next} - ${LOCKOUT_THRESHOLD})::int))
          ELSE ${userAccounts.lockedUntil} END`,
      })
      .where(eq(userAccounts.id, userId))
      .returning({ count: userAccounts.failedLoginCount, lockedUntil: userAccounts.lockedUntil });
    return { count: row?.count ?? 0, lockedUntil: row?.lockedUntil ?? null };
  }

  private sendInBackground(email: Parameters<Mailer['send']>[0]): void {
    this.mailer.send(email).catch((error: unknown) => {
      this.logger.warn(
        `email "${email.subject}" not sent: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    });
  }
}
