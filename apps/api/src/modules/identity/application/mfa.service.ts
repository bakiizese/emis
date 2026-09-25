import type { MfaVerifyRequest, RecoveryCodesResponse, TotpSetupResponse } from '@emis/contracts';
import { userAccounts, userRecoveryCodes, userTotpFactors } from '@emis/db';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';

import { SecretBox } from '../../../common/crypto/secret-box.js';
import { APP_CONFIG } from '../../../config/config.module.js';
import type { Env } from '../../../config/env.js';
import type { DbAdapter } from '../../../database/database.module.js';
import { authErrors } from '../domain/errors.js';
import { generateRecoveryCodes, hashRecoveryCode } from '../domain/recovery-codes.js';
import type { AuthContext, RequestContext } from '../domain/types.js';
import { PasswordHasher } from '../infrastructure/password-hasher.js';
import { TotpProvider } from '../infrastructure/totp.js';
import { SecurityEventsService } from './security-events.service.js';
import { MAX_MFA_ATTEMPTS, SessionsService } from './sessions.service.js';

const secretContext = (userId: string) => `totp-secret:${userId}`;

@Injectable()
export class MfaService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly box: SecretBox,
    private readonly totp: TotpProvider,
    private readonly sessions: SessionsService,
    private readonly hasher: PasswordHasher,
    private readonly events: SecurityEventsService,
    @Inject(APP_CONFIG) private readonly env: Env,
  ) {}

  private get db() {
    return this.txHost.tx;
  }

  /** Start (or restart) enrollment. The factor stays unconfirmed until a valid code comes back. */
  async setup(auth: AuthContext): Promise<TotpSetupResponse> {
    if (auth.mfaEnabled) throw authErrors.mfaAlreadyEnabled();

    const secret = this.totp.createSecret();
    const secretCiphertext = this.box.encrypt(secret, secretContext(auth.userId));
    await this.db
      .insert(userTotpFactors)
      .values({ userId: auth.userId, secretCiphertext })
      .onConflictDoUpdate({
        target: userTotpFactors.userId,
        set: { secretCiphertext, confirmedAt: null, lastUsedTimeStep: null, updatedAt: new Date() },
        setWhere: isNull(userTotpFactors.confirmedAt),
      });

    const otpauthUri = this.totp.uri(secret, auth.email, this.env.APP_NAME);
    return { secret, otpauthUri, qrCodeSvg: await this.totp.qrCodeSvg(otpauthUri) };
  }

  /** Finish enrollment with a code from the app. Returns fresh recovery codes and a rotated session token. */
  async confirm(
    auth: AuthContext,
    code: string,
    context: RequestContext,
  ): Promise<{ token: string; response: RecoveryCodesResponse }> {
    const factor = await this.loadFactor(auth.userId);
    if (!factor) throw authErrors.mfaNotEnabled();
    if (factor.confirmedAt) throw authErrors.mfaAlreadyEnabled();

    const step = await this.totp.verify(this.secretOf(factor, auth.userId), code, null);
    if (step === null) return this.fail(auth, context);

    return this.enable(auth, factor.id, step, context);
  }

  /** Second step of sign-in: a TOTP code or a single-use recovery code. */
  async verify(
    auth: AuthContext,
    input: MfaVerifyRequest,
    context: RequestContext,
  ): Promise<{ token: string }> {
    const factor = await this.loadFactor(auth.userId);
    if (!factor?.confirmedAt) throw authErrors.mfaNotEnabled();

    let method: 'totp' | 'recovery_code';
    if ('code' in input) {
      const step = await this.totp.verify(
        this.secretOf(factor, auth.userId),
        input.code,
        factor.lastUsedTimeStep,
      );
      if (step === null || !(await this.claimTimeStep(auth.userId, step)))
        return this.fail(auth, context);
      method = 'totp';
    } else {
      if (!(await this.consumeRecoveryCode(auth.userId, input.recoveryCode)))
        return this.fail(auth, context);
      method = 'recovery_code';
    }

    const token = await this.sessions.rotate(auth.sessionId, { markMfaVerified: true });
    await this.events.record(
      method === 'totp' ? 'mfa.succeeded' : 'mfa.recovery_code_used',
      context,
      {
        userId: auth.userId,
      },
    );
    return { token };
  }

  async disable(
    auth: AuthContext,
    input: { password: string; code: string },
    context: RequestContext,
  ): Promise<void> {
    if (auth.mfaEnforced) throw authErrors.mfaEnforced();
    const factor = await this.loadFactor(auth.userId);
    if (!factor?.confirmedAt) throw authErrors.mfaNotEnabled();

    const [account] = await this.db
      .select({ passwordHash: userAccounts.passwordHash })
      .from(userAccounts)
      .where(eq(userAccounts.id, auth.userId));
    const passwordOk = await this.hasher.verify(account?.passwordHash ?? null, input.password);
    const step = await this.totp.verify(
      this.secretOf(factor, auth.userId),
      input.code,
      factor.lastUsedTimeStep,
    );
    if (!passwordOk || step === null) throw authErrors.invalidMfaCode();

    await this.removeFactor(auth.userId, context);
  }

  @Transactional()
  private async removeFactor(userId: string, context: RequestContext): Promise<void> {
    await this.db.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId));
    await this.db.delete(userTotpFactors).where(eq(userTotpFactors.userId, userId));
    await this.events.record('mfa.disabled', context, { userId });
  }

  @Transactional()
  private async enable(
    auth: AuthContext,
    factorId: string,
    step: number,
    context: RequestContext,
  ): Promise<{ token: string; response: RecoveryCodesResponse }> {
    await this.db
      .update(userTotpFactors)
      .set({ confirmedAt: new Date(), lastUsedTimeStep: step, updatedAt: new Date() })
      .where(eq(userTotpFactors.id, factorId));

    const recoveryCodes = generateRecoveryCodes();
    await this.db.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, auth.userId));
    await this.db
      .insert(userRecoveryCodes)
      .values(
        recoveryCodes.map((code) => ({ userId: auth.userId, codeHash: hashRecoveryCode(code) })),
      );

    const token = await this.sessions.rotate(auth.sessionId, { markMfaVerified: true });
    await this.events.record('mfa.enabled', context, { userId: auth.userId });
    return { token, response: { recoveryCodes } };
  }

  /** Wrong code: count it, and end the session after too many tries. Always throws. */
  private async fail(auth: AuthContext, context: RequestContext): Promise<never> {
    const attempts = await this.sessions.recordMfaFailure(auth.sessionId);
    await this.events.record('mfa.failed', context, {
      userId: auth.userId,
      metadata: { attempts },
    });
    if (attempts >= MAX_MFA_ATTEMPTS) {
      await this.sessions.revoke(auth.sessionId, 'too_many_mfa_attempts');
      throw authErrors.unauthenticated();
    }
    throw authErrors.invalidMfaCode();
  }

  /** Record the step as used; false if a concurrent request already used this or a later step. */
  private async claimTimeStep(userId: string, step: number): Promise<boolean> {
    const rows = await this.db
      .update(userTotpFactors)
      .set({ lastUsedTimeStep: step })
      .where(
        and(
          eq(userTotpFactors.userId, userId),
          or(isNull(userTotpFactors.lastUsedTimeStep), lt(userTotpFactors.lastUsedTimeStep, step)),
        ),
      )
      .returning({ id: userTotpFactors.id });
    return rows.length > 0;
  }

  private async consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
    const rows = await this.db
      .update(userRecoveryCodes)
      .set({ usedAt: sql`now()` })
      .where(
        and(
          eq(userRecoveryCodes.userId, userId),
          eq(userRecoveryCodes.codeHash, hashRecoveryCode(code)),
          isNull(userRecoveryCodes.usedAt),
        ),
      )
      .returning({ id: userRecoveryCodes.id });
    return rows.length > 0;
  }

  private async loadFactor(userId: string) {
    const [factor] = await this.db
      .select()
      .from(userTotpFactors)
      .where(eq(userTotpFactors.userId, userId))
      .limit(1);
    return factor ?? null;
  }

  /** Decrypt the seed, re-encrypting it under the current key if it was sealed with an old one. */
  private secretOf(factor: { id: string; secretCiphertext: string }, userId: string): string {
    const secret = this.box.decrypt(factor.secretCiphertext, secretContext(userId));
    if (!this.box.isCurrent(factor.secretCiphertext)) {
      void this.db
        .update(userTotpFactors)
        .set({ secretCiphertext: this.box.encrypt(secret, secretContext(userId)) })
        .where(eq(userTotpFactors.id, factor.id))
        .catch(() => undefined);
    }
    return secret;
  }
}
