import { randomBytes } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  decrypt,
  decryptCredentials,
  encrypt,
  encryptCredentials,
  EncryptionKeyError,
  loadEncryptionKey,
} from '../../../src/lib/crypto';

const VALID_HEX_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('encrypt / decrypt round trip', () => {
  const key = randomBytes(32);

  it('preserves ASCII plaintext', () => {
    const plaintext = 'hello world';
    expect(decrypt(encrypt(plaintext, key), key)).toBe(plaintext);
  });

  it('preserves empty string', () => {
    expect(decrypt(encrypt('', key), key)).toBe('');
  });

  it('preserves UTF-8 plaintext (Turkish + emoji)', () => {
    const plaintext = 'Merhaba, Türkiye! 🇹🇷 ğüşıöç';
    expect(decrypt(encrypt(plaintext, key), key)).toBe(plaintext);
  });

  it('preserves long plaintext', () => {
    const plaintext = 'a'.repeat(10_000);
    expect(decrypt(encrypt(plaintext, key), key)).toBe(plaintext);
  });
});

describe('IV randomness', () => {
  const key = randomBytes(32);

  it('produces different ciphertexts for the same plaintext', () => {
    const plaintext = 'same-input';
    const a = encrypt(plaintext, key);
    const b = encrypt(plaintext, key);
    expect(a).not.toBe(b);
    // Both still decrypt to the same plaintext.
    expect(decrypt(a, key)).toBe(plaintext);
    expect(decrypt(b, key)).toBe(plaintext);
  });
});

describe('authentication (GCM tag)', () => {
  const key = randomBytes(32);

  it('throws when ciphertext body is tampered', () => {
    const encoded = encrypt('payload', key);
    const buffer = Buffer.from(encoded, 'base64');
    // Flip one bit in the ciphertext region (after IV + auth tag).
    buffer[buffer.length - 1] = buffer[buffer.length - 1]! ^ 0x01;
    const tampered = buffer.toString('base64');
    expect(() => decrypt(tampered, key)).toThrow();
  });

  it('throws when auth tag is tampered', () => {
    const encoded = encrypt('payload', key);
    const buffer = Buffer.from(encoded, 'base64');
    // Flip one bit inside the auth tag (bytes 12..28).
    buffer[20] = buffer[20]! ^ 0x01;
    const tampered = buffer.toString('base64');
    expect(() => decrypt(tampered, key)).toThrow();
  });

  it('throws when decrypted with the wrong key', () => {
    const encoded = encrypt('payload', key);
    const wrongKey = randomBytes(32);
    expect(() => decrypt(encoded, wrongKey)).toThrow();
  });

  it('throws when the ciphertext is shorter than IV + auth tag', () => {
    const tooShort = Buffer.alloc(10).toString('base64');
    expect(() => decrypt(tooShort, key)).toThrow(/too short/);
  });
});

describe('key length validation', () => {
  it('throws on encrypt with a non-32-byte key', () => {
    expect(() => encrypt('payload', randomBytes(16))).toThrow(/32 bytes/);
  });

  it('throws on decrypt with a non-32-byte key', () => {
    const encoded = encrypt('payload', randomBytes(32));
    expect(() => decrypt(encoded, randomBytes(16))).toThrow(/32 bytes/);
  });
});

describe('loadEncryptionKey', () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env['ENCRYPTION_KEY'];
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env['ENCRYPTION_KEY'];
    } else {
      process.env['ENCRYPTION_KEY'] = original;
    }
  });

  it('returns the decoded key when the env var is valid hex of the right length', () => {
    process.env['ENCRYPTION_KEY'] = VALID_HEX_KEY;
    expect(loadEncryptionKey().toString('hex')).toBe(VALID_HEX_KEY);
  });

  it('throws EncryptionKeyError when ENCRYPTION_KEY is missing', () => {
    delete process.env['ENCRYPTION_KEY'];
    expect(() => loadEncryptionKey()).toThrow(EncryptionKeyError);
  });

  it('throws EncryptionKeyError when ENCRYPTION_KEY is empty', () => {
    process.env['ENCRYPTION_KEY'] = '';
    expect(() => loadEncryptionKey()).toThrow(EncryptionKeyError);
  });

  it('throws EncryptionKeyError when ENCRYPTION_KEY is not hex', () => {
    process.env['ENCRYPTION_KEY'] = 'not-hex!!';
    expect(() => loadEncryptionKey()).toThrow(/hex-encoded/);
  });

  it('throws EncryptionKeyError when ENCRYPTION_KEY is the wrong length', () => {
    process.env['ENCRYPTION_KEY'] = 'deadbeef';
    expect(() => loadEncryptionKey()).toThrow(/32 bytes/);
  });
});

describe('credential helpers', () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env['ENCRYPTION_KEY'];
    process.env['ENCRYPTION_KEY'] = VALID_HEX_KEY;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env['ENCRYPTION_KEY'];
    } else {
      process.env['ENCRYPTION_KEY'] = original;
    }
  });

  it('round-trips a credentials object', () => {
    const creds = { apiKey: 'key123', apiSecret: 'secret456', sellerId: 12345 };
    const encoded = encryptCredentials(creds);
    expect(decryptCredentials(encoded)).toEqual(creds);
  });

  it('returns `unknown` from decryptCredentials — caller must narrow', () => {
    const encoded = encryptCredentials({ foo: 'bar' });
    const decoded: unknown = decryptCredentials(encoded);
    // Demonstrates the type guard pattern required by CLAUDE.md ("no `as`").
    if (
      typeof decoded === 'object' &&
      decoded !== null &&
      'foo' in decoded &&
      typeof decoded.foo === 'string'
    ) {
      expect(decoded.foo).toBe('bar');
    } else {
      throw new Error('decryptCredentials returned an unexpected shape');
    }
  });
});
