import { describe, expect, it } from 'vitest';

import { PasswordPolicy } from './password-policy.js';

describe('PasswordPolicy', () => {
  const policy = new PasswordPolicy();

  it('accepts long, unpredictable passphrases', () => {
    expect(policy.check('lantern-orbit-velvet-cactus', ['hana@lingua.et']).ok).toBe(true);
  });

  it.each([
    ['too short', 'Sh0rt!pw'],
    ['a common password padded out', 'password1234'],
    ['a keyboard walk', 'qwertyuiop123'],
    ['repeated characters', 'aaaaaaaaaaaaaaa'],
  ])('rejects %s', (_label, password) => {
    expect(policy.check(password, []).ok).toBe(false);
  });

  it("rejects passwords built from the person's own details", () => {
    const result = policy.check('abebe.kebede-2026!', ['abebe.kebede@lingua.et', 'Abebe Kebede']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/name or email/);
  });
});
