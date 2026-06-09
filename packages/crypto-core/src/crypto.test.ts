import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { decrypt, encrypt, KEY_LENGTH_BYTES } from './index';

const key = (): Buffer => randomBytes(KEY_LENGTH_BYTES);

describe('crypto-core AES-256-GCM envelope', () => {
  it('round-trips UTF-8 plaintext (incl. Turkish + JSON)', () => {
    const k = key();
    const plain = JSON.stringify({ apiKey: 'gizli-anahtar', note: 'çğıöşü' });
    expect(decrypt(encrypt(plain, k), k)).toBe(plain);
  });

  it('produces a fresh IV per call (same input → different ciphertext)', () => {
    const k = key();
    expect(encrypt('x', k)).not.toBe(encrypt('x', k));
  });

  it('fails to decrypt with a different key (GCM auth)', () => {
    const blob = encrypt('secret', key());
    expect(() => decrypt(blob, key())).toThrow();
  });

  it('rejects a tampered ciphertext', () => {
    const k = key();
    const blob = Buffer.from(encrypt('secret', k), 'base64');
    blob[blob.length - 1]! ^= 0xff;
    expect(() => decrypt(blob.toString('base64'), k)).toThrow();
  });

  it('rejects a wrong-length key', () => {
    expect(() => encrypt('x', randomBytes(16))).toThrow(/32 bytes/);
  });
});
