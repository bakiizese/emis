import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { SecretBox, SecretBoxError } from './secret-box.js';

describe('SecretBox', () => {
  const key = randomBytes(32);
  const box = new SecretBox(key);

  it('round-trips and never returns the plaintext in the payload', () => {
    const sealed = box.encrypt('JBSWY3DPEHPK3PXPJBSWY3DP', 'totp:user-1');
    expect(sealed).not.toContain('JBSWY3DP');
    expect(box.decrypt(sealed, 'totp:user-1')).toBe('JBSWY3DPEHPK3PXPJBSWY3DP');
  });

  it('uses a fresh IV every time', () => {
    expect(box.encrypt('same', 'ctx')).not.toBe(box.encrypt('same', 'ctx'));
  });

  it('refuses ciphertext moved to another context', () => {
    const sealed = box.encrypt('secret', 'totp:user-1');
    expect(() => box.decrypt(sealed, 'totp:user-2')).toThrow(SecretBoxError);
  });

  it('detects tampering', () => {
    const parts = box.encrypt('secret', 'ctx').split('.');
    const ciphertext = Buffer.from(parts[3] ?? '', 'base64url');
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 0xff;
    parts[3] = ciphertext.toString('base64url');
    expect(() => box.decrypt(parts.join('.'), 'ctx')).toThrow(SecretBoxError);
  });

  it('keeps decrypting old payloads after a key rotation', () => {
    const sealedWithOld = box.encrypt('secret', 'ctx');
    const rotated = new SecretBox(randomBytes(32), [key]);

    expect(rotated.decrypt(sealedWithOld, 'ctx')).toBe('secret');
    expect(rotated.isCurrent(sealedWithOld)).toBe(false);
    expect(rotated.isCurrent(rotated.encrypt('secret', 'ctx'))).toBe(true);
  });

  it('rejects payloads from an unknown key', () => {
    const other = new SecretBox(randomBytes(32));
    expect(() => box.decrypt(other.encrypt('x', 'ctx'), 'ctx')).toThrow(/Unknown encryption key/);
  });
});
