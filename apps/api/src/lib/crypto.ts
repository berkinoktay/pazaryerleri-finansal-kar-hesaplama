import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM: NIST-recommended, authenticated encryption. The 12-byte IV
// length is what SP 800-38D specifies as the default for GCM (other lengths
// force an internal GHASH computation that reduces the per-key message limit).
// The 16-byte auth tag is the GCM default and the only length accepted by
// most compliance frameworks.
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

const ENCRYPTION_KEY_ENV = 'ENCRYPTION_KEY';

export class EncryptionKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptionKeyError';
  }
}

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

/**
 * Read the AES-256 key from the `ENCRYPTION_KEY` env var (hex-encoded,
 * 64 hex chars / 32 bytes). Throws `EncryptionKeyError` if missing or the
 * wrong length — failing fast is preferable to silently encrypting with
 * a weakened key.
 */
export function loadEncryptionKey(): Buffer {
  const raw = process.env[ENCRYPTION_KEY_ENV];
  if (raw === undefined || raw.length === 0) {
    throw new EncryptionKeyError(
      `${ENCRYPTION_KEY_ENV} is required. Generate one with \`pnpm gen:encryption-key\`.`,
    );
  }
  if (!/^[0-9a-fA-F]+$/.test(raw)) {
    throw new EncryptionKeyError(`${ENCRYPTION_KEY_ENV} must be hex-encoded.`);
  }
  const key = Buffer.from(raw, 'hex');
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new EncryptionKeyError(
      `${ENCRYPTION_KEY_ENV} must decode to ${KEY_LENGTH_BYTES.toString()} bytes ` +
        `(${(KEY_LENGTH_BYTES * 2).toString()} hex chars). Got ${key.length.toString()} bytes.`,
    );
  }
  return key;
}

/**
 * Encrypt a JSON-serializable credentials object with the key loaded from
 * the environment. Primary use: marketplace API keys/secrets before writing
 * to the `stores.credentials` column.
 */
export function encryptCredentials(credentials: Record<string, unknown>): string {
  return encrypt(JSON.stringify(credentials), loadEncryptionKey());
}

/**
 * Decrypt a credentials blob. Returns `unknown` — callers MUST narrow with
 * a type guard (e.g. `isTrendyolCredentials`) before using the value.
 */
export function decryptCredentials(encoded: string): unknown {
  return JSON.parse(decrypt(encoded, loadEncryptionKey()));
}

function assertKeyLength(key: Buffer): void {
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `Encryption key must be ${KEY_LENGTH_BYTES.toString()} bytes, got ${key.length.toString()}.`,
    );
  }
}
