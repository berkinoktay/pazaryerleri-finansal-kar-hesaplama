import { decrypt, encrypt, KEY_LENGTH_BYTES } from '@pazarsync/crypto-core';

// The AES-256-GCM envelope (encrypt/decrypt) lives in @pazarsync/crypto-core,
// a dependency-free leaf, so the wire format is shared with packages/db's seed
// script without a workspace cycle. This module adds the env-keyed wrappers
// used at runtime by the api + sync-worker.
const ENCRYPTION_KEY_ENV = 'ENCRYPTION_KEY';

/**
 * Thrown when `ENCRYPTION_KEY` is missing or malformed. Maps to 500
 * `SERVER_CONFIG_ERROR` via `problemDetailsForError` — the `code`
 * makes ops log-scanning find this fast (vs. "just another 500").
 *
 * `validateRequiredEnv()` at boot catches this case early, so in
 * practice it cannot reach a live request. The class/branch pair
 * is kept as defense-in-depth for any future caller that loads the
 * key lazily (e.g. key rotation, per-tenant keys).
 */
export class EncryptionKeyError extends Error {
  readonly status = 500 as const;
  readonly code = 'SERVER_CONFIG_ERROR' as const;

  constructor(message: string) {
    super(message);
    this.name = 'EncryptionKeyError';
  }
}

// Re-export the pure cipher primitives so existing `@pazarsync/sync-core`
// imports keep working; the implementation is the crypto-core leaf.
export { decrypt, encrypt };

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
