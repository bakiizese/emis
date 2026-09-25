import { randomBytes } from 'node:crypto';

import { Algorithm, hash, verify } from '@node-rs/argon2';
import { Injectable } from '@nestjs/common';

// OWASP Password Storage Cheat Sheet minimum for Argon2id: m=19 MiB, t=2, p=1.
const OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;
const CURRENT_PARAMS = `$argon2id$v=19$m=${OPTIONS.memoryCost},t=${OPTIONS.timeCost},p=${OPTIONS.parallelism}$`;

@Injectable()
export class PasswordHasher {
  private dummyHash?: Promise<string>;

  hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  /**
   * Constant-work verification: when there is no stored hash (unknown email, no password yet)
   * we still verify against a dummy hash, so response time doesn't reveal whether an account exists.
   */
  async verify(storedHash: string | null, password: string): Promise<boolean> {
    const target = storedHash ?? (await this.getDummyHash());
    try {
      const matches = await verify(target, password);
      return storedHash !== null && matches;
    } catch {
      return false;
    }
  }

  /** True when the stored hash uses older parameters and should be upgraded on next login. */
  needsRehash(storedHash: string): boolean {
    return !storedHash.startsWith(CURRENT_PARAMS);
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hash(randomBytes(32).toString('hex'), OPTIONS);
    return this.dummyHash;
  }
}
