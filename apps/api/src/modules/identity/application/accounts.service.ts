import { emailSchema } from '@emis/contracts';
import { type AccountStatus, userAccounts } from '@emis/db';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import type { DbAdapter } from '../../../database/database.module.js';
import { authErrors } from '../domain/errors.js';
import { PasswordPolicy } from '../domain/password-policy.js';
import { PasswordHasher } from '../infrastructure/password-hasher.js';

export interface NewAccount {
  email: string;
  displayName: string;
  /** Omit for invited accounts that will set their own password. */
  password?: string;
  mfaEnforced?: boolean;
}

function isUniqueViolation(error: unknown): boolean {
  const code = (e: unknown) =>
    typeof e === 'object' && e !== null && 'code' in e ? e.code : undefined;
  return code(error) === '23505' || code((error as { cause?: unknown }).cause) === '23505';
}

@Injectable()
export class AccountsService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly hasher: PasswordHasher,
    private readonly policy: PasswordPolicy,
  ) {}

  async findByEmail(email: string) {
    const [account] = await this.txHost.tx
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.email, email))
      .limit(1);
    return account ?? null;
  }

  async findById(id: string) {
    const [account] = await this.txHost.tx
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.id, id))
      .limit(1);
    return account ?? null;
  }

  async create(input: NewAccount): Promise<{ id: string }> {
    const email = emailSchema.parse(input.email);
    const displayName = input.displayName.trim();
    let passwordHash: string | null = null;

    if (input.password !== undefined) {
      const check = this.policy.check(input.password, [email, displayName]);
      if (!check.ok) throw authErrors.weakPassword(check.reason);
      passwordHash = await this.hasher.hash(input.password);
    }

    try {
      const [row] = await this.txHost.tx
        .insert(userAccounts)
        .values({
          email,
          displayName,
          passwordHash,
          passwordChangedAt: passwordHash ? new Date() : null,
          mfaEnforced: input.mfaEnforced ?? false,
        })
        .returning({ id: userAccounts.id });
      if (!row) throw new Error('Account insert returned no row');
      return row;
    } catch (error) {
      if (isUniqueViolation(error)) throw authErrors.emailTaken();
      throw error;
    }
  }

  /** Set (or replace) a password after checking it against the policy. */
  async setPassword(userId: string, password: string): Promise<void> {
    const account = await this.findById(userId);
    if (!account) throw new Error(`Account ${userId} not found`);
    const check = this.policy.check(password, [account.email, account.displayName]);
    if (!check.ok) throw authErrors.weakPassword(check.reason);

    await this.txHost.tx
      .update(userAccounts)
      .set({
        passwordHash: await this.hasher.hash(password),
        passwordChangedAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
      })
      .where(eq(userAccounts.id, userId));
  }

  async setStatus(userId: string, status: AccountStatus): Promise<void> {
    await this.txHost.tx.update(userAccounts).set({ status }).where(eq(userAccounts.id, userId));
  }

  /** From now on this account must use two-factor authentication (e.g. it was given an admin role). */
  async enforceMfa(userId: string): Promise<void> {
    await this.txHost.tx
      .update(userAccounts)
      .set({ mfaEnforced: true })
      .where(eq(userAccounts.id, userId));
  }
}
