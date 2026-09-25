import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretBoxError';
  }
}

/**
 * Authenticated encryption for secrets stored in the database (AES-256-GCM).
 *
 * Output: `v1.<keyId>.<iv>.<ciphertext>.<tag>` (base64url parts). The key id lets old rows keep
 * decrypting after a rotation: set the new ENCRYPTION_KEY and move the old one to
 * ENCRYPTION_KEYS_PREVIOUS. `context` is bound as associated data, so a ciphertext copied into
 * another row (e.g. another user's TOTP secret) fails to decrypt.
 */
export class SecretBox {
  private readonly keys = new Map<string, Buffer>();
  private readonly currentKeyId: string;

  constructor(currentKey: Buffer, previousKeys: readonly Buffer[] = []) {
    for (const key of [currentKey, ...previousKeys]) {
      if (key.length !== 32) throw new SecretBoxError('Encryption keys must be 32 bytes');
      this.keys.set(SecretBox.keyId(key), key);
    }
    this.currentKeyId = SecretBox.keyId(currentKey);
  }

  static keyId(key: Buffer): string {
    return createHash('sha256').update(key).digest('hex').slice(0, 12);
  }

  encrypt(plaintext: string, context: string): string {
    const key = this.keys.get(this.currentKeyId);
    if (!key) throw new SecretBoxError('Current key missing');
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [VERSION, this.currentKeyId, iv, ciphertext, cipher.getAuthTag()]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join('.');
  }

  decrypt(payload: string, context: string): string {
    const parts = payload.split('.');
    if (parts.length !== 5 || parts[0] !== VERSION) throw new SecretBoxError('Unsupported payload');
    const [, keyId, iv, ciphertext, tag] = parts as [string, string, string, string, string];
    const key = this.keys.get(keyId);
    if (!key) throw new SecretBoxError('Unknown encryption key');

    try {
      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64url'));
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new SecretBoxError('Decryption failed');
    }
  }

  /** False when the payload was sealed with an older key and should be re-encrypted. */
  isCurrent(payload: string): boolean {
    return payload.split('.')[1] === this.currentKeyId;
  }
}
