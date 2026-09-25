import { describe, expect, it } from 'vitest';

import {
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from './recovery-codes.js';

describe('recovery codes', () => {
  it('generates 10 unique, readable codes', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[A-HJKMNP-TV-Z2-9]{5}-[A-HJKMNP-TV-Z2-9]{5}$/);
  });

  it('matches however the user types it', () => {
    expect(normalizeRecoveryCode(' k7qmz 4whxp ')).toBe('K7QMZ4WHXP');
    expect(hashRecoveryCode('k7qmz-4whxp')).toBe(hashRecoveryCode('K7QMZ4WHXP'));
  });
});
