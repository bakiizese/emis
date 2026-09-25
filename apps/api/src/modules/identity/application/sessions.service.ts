import { userAccounts, userSessions, userTotpFactors } from '@emis/db';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';

import { APP_CONFIG } from '../../../config/config.module.js';
import type { Env } from '../../../config/env.js';
import type { DbAdapter } from '../../../database/database.module.js';
import { generateToken, hashToken } from '../domain/tokens.js';
import { type AuthContext, nextStepFor, type RequestContext } from '../domain/types.js';

const TOUCH_INTERVAL_MS = 60_000;
export const MAX_MFA_ATTEMPTS = 5;

@Injectable()
export class SessionsService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    @Inject(APP_CONFIG) private readonly env: Env,
  ) {}

  private get db() {
    return this.txHost.tx;
  }

  private expiries(now: Date, absoluteExpiresAt?: Date) {
    const absolute =
      absoluteExpiresAt ?? new Date(now.getTime() + this.env.SESSION_ABSOLUTE_HOURS * 3_600_000);
    const idle = new Date(
      Math.min(now.getTime() + this.env.SESSION_IDLE_MINUTES * 60_000, absolute.getTime()),
    );
    return { idle, absolute };
  }

  async create(
    userId: string,
    context: RequestContext,
    options: { mfaVerified: boolean },
  ): Promise<{ token: string; sessionId: string }> {
    const token = generateToken();
    const now = new Date();
    const { idle, absolute } = this.expiries(now);
    const [row] = await this.db
      .insert(userSessions)
      .values({
        userId,
        tokenHash: hashToken(token),
        idleExpiresAt: idle,
        absoluteExpiresAt: absolute,
        mfaVerifiedAt: options.mfaVerified ? now : null,
        ipAddress: context.ip,
        userAgent: context.userAgent,
      })
      .returning({ id: userSessions.id });
    if (!row) throw new Error('Session insert returned no row');
    return { token, sessionId: row.id };
  }

  /** Resolve a cookie token to a live session, sliding the idle timeout. Null when invalid or expired. */
  async authenticate(token: string): Promise<AuthContext | null> {
    const now = new Date();
    const [row] = await this.db
      .select({
        sessionId: userSessions.id,
        createdAt: userSessions.createdAt,
        lastSeenAt: userSessions.lastSeenAt,
        absoluteExpiresAt: userSessions.absoluteExpiresAt,
        mfaVerifiedAt: userSessions.mfaVerifiedAt,
        userId: userAccounts.id,
        email: userAccounts.email,
        displayName: userAccounts.displayName,
        mfaEnforced: userAccounts.mfaEnforced,
        factorConfirmedAt: userTotpFactors.confirmedAt,
      })
      .from(userSessions)
      .innerJoin(userAccounts, eq(userAccounts.id, userSessions.userId))
      .leftJoin(userTotpFactors, eq(userTotpFactors.userId, userSessions.userId))
      .where(
        and(
          eq(userSessions.tokenHash, hashToken(token)),
          isNull(userSessions.revokedAt),
          gt(userSessions.idleExpiresAt, now),
          gt(userSessions.absoluteExpiresAt, now),
          eq(userAccounts.status, 'active'),
        ),
      )
      .limit(1);
    if (!row) return null;

    if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      const { idle } = this.expiries(now, row.absoluteExpiresAt);
      await this.db
        .update(userSessions)
        .set({ lastSeenAt: now, idleExpiresAt: idle })
        .where(eq(userSessions.id, row.sessionId));
    }

    const state = {
      mfaEnabled: row.factorConfirmedAt !== null,
      mfaEnforced: row.mfaEnforced,
      mfaVerified: row.mfaVerifiedAt !== null,
    };
    return {
      sessionId: row.sessionId,
      userId: row.userId,
      email: row.email,
      displayName: row.displayName,
      ...state,
      sessionCreatedAt: row.createdAt,
      absoluteExpiresAt: row.absoluteExpiresAt,
      nextStep: nextStepFor(state),
    };
  }

  /** New token for the same session (after MFA, password change): defeats session fixation. */
  async rotate(sessionId: string, options: { markMfaVerified: boolean }): Promise<string> {
    const token = generateToken();
    const now = new Date();
    await this.db
      .update(userSessions)
      .set({
        tokenHash: hashToken(token),
        lastSeenAt: now,
        mfaFailedAttempts: 0,
        ...(options.markMfaVerified ? { mfaVerifiedAt: now } : {}),
      })
      .where(eq(userSessions.id, sessionId));
    return token;
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.db
      .update(userSessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(userSessions.id, sessionId), isNull(userSessions.revokedAt)));
  }

  /** Revoke a session only if it belongs to the user. Returns false when there was nothing to revoke. */
  async revokeOwn(userId: string, sessionId: string, reason: string): Promise<boolean> {
    const rows = await this.db
      .update(userSessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(
        and(
          eq(userSessions.id, sessionId),
          eq(userSessions.userId, userId),
          isNull(userSessions.revokedAt),
        ),
      )
      .returning({ id: userSessions.id });
    return rows.length > 0;
  }

  async revokeAllForUser(
    userId: string,
    reason: string,
    exceptSessionId?: string,
  ): Promise<number> {
    const rows = await this.db
      .update(userSessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(
        and(
          eq(userSessions.userId, userId),
          isNull(userSessions.revokedAt),
          exceptSessionId ? ne(userSessions.id, exceptSessionId) : undefined,
        ),
      )
      .returning({ id: userSessions.id });
    return rows.length;
  }

  /** Counts a wrong MFA code; returns the running total for this session. */
  async recordMfaFailure(sessionId: string): Promise<number> {
    const [row] = await this.db
      .update(userSessions)
      .set({ mfaFailedAttempts: sql`${userSessions.mfaFailedAttempts} + 1` })
      .where(eq(userSessions.id, sessionId))
      .returning({ attempts: userSessions.mfaFailedAttempts });
    return row?.attempts ?? MAX_MFA_ATTEMPTS;
  }

  listActive(userId: string) {
    const now = new Date();
    return this.db
      .select({
        id: userSessions.id,
        createdAt: userSessions.createdAt,
        lastSeenAt: userSessions.lastSeenAt,
        ipAddress: userSessions.ipAddress,
        userAgent: userSessions.userAgent,
      })
      .from(userSessions)
      .where(
        and(
          eq(userSessions.userId, userId),
          isNull(userSessions.revokedAt),
          gt(userSessions.idleExpiresAt, now),
          gt(userSessions.absoluteExpiresAt, now),
        ),
      )
      .orderBy(desc(userSessions.lastSeenAt));
  }
}
