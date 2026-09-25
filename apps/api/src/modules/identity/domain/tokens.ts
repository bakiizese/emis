import { createHash, randomBytes } from 'node:crypto';

/** 256-bit random token, URL-safe. Used for session cookies and reset links. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Tokens are stored as SHA-256 only; a database leak doesn't hand out live sessions. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
