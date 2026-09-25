import { describe, expect, it } from 'vitest';

import {
  loginRequestSchema,
  mfaVerifyRequestSchema,
  newPasswordSchema,
  totpCodeSchema,
} from './auth.js';

describe('auth contracts', () => {
  it('normalizes emails', () => {
    expect(loginRequestSchema.parse({ email: '  Hana@Example.COM ', password: 'x' }).email).toBe(
      'hana@example.com',
    );
    expect(loginRequestSchema.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(
      false,
    );
  });

  it('bounds new passwords', () => {
    expect(newPasswordSchema.safeParse('short').success).toBe(false);
    expect(newPasswordSchema.safeParse('a'.repeat(129)).success).toBe(false);
    expect(newPasswordSchema.safeParse('correct horse battery').success).toBe(true);
  });

  it('accepts only 6-digit TOTP codes', () => {
    expect(totpCodeSchema.parse(' 123456 ')).toBe('123456');
    expect(totpCodeSchema.safeParse('12345').success).toBe(false);
    expect(totpCodeSchema.safeParse('abcdef').success).toBe(false);
  });

  it('verifies MFA with either a code or a recovery code', () => {
    expect(mfaVerifyRequestSchema.safeParse({ code: '123456' }).success).toBe(true);
    expect(mfaVerifyRequestSchema.safeParse({ recoveryCode: 'ABCDE-FGHJK' }).success).toBe(true);
    expect(mfaVerifyRequestSchema.safeParse({}).success).toBe(false);
  });
});
