import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM: NIST-recommended, authenticated encryption. The 12-byte IV
// length is what SP 800-38D specifies as the default for GCM (other lengths
// force an internal GHASH computation that reduces the per-key message limit).
// The 16-byte auth tag is the GCM default and the only length accepted by
// most compliance frameworks.
//
// This is the SINGLE source of truth for the credential-encryption envelope.
// Both @pazarsync/sync-core (runtime, env-keyed wrappers) and packages/db's
// seed script depend on it, so the wire format can never drift between the
// blob the seed writes and the blob the marketplace adapter decrypts. It is a
// dependency-free leaf (only `node:crypto`) so any package may import it
// without a workspace cycle.
const ALGORITHM = 'aes-256-gcm';
export const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

/**
 * Encrypt UTF-8 plaintext with AES-256-GCM. Returns a base64 string
 * containing `iv || authTag || ciphertext` — self-contained and safe to
 * store as a single DB column.
 */
export function encrypt(plaintext: string, key: Buffer): string {
  assertKeyLength(key);
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

/**
 * Decrypt a string produced by `encrypt`. Throws if the ciphertext has been
 * tampered with, was produced by a different key, or is otherwise malformed.
 */
export function decrypt(encoded: string, key: Buffer): string {
  assertKeyLength(key);
  const buffer = Buffer.from(encoded, 'base64');
  if (buffer.length < IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES) {
    throw new Error('Ciphertext is too short to contain IV + auth tag');
  }
  const iv = buffer.subarray(0, IV_LENGTH_BYTES);
  const authTag = buffer.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
  const ciphertext = buffer.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

function assertKeyLength(key: Buffer): void {
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `Encryption key must be ${KEY_LENGTH_BYTES.toString()} bytes, got ${key.length.toString()}.`,
    );
  }
}
