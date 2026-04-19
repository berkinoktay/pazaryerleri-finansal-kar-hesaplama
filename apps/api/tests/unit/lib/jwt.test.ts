import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UnauthorizedError } from '../../../src/lib/errors';
import { verifySupabaseJwt } from '../../../src/lib/jwt';

const TEST_SECRET = 'test-jwt-secret-at-least-32-bytes-for-hs256';
const SECRET_BYTES = new TextEncoder().encode(TEST_SECRET);

async function makeToken(
  payload: Record<string, unknown>,
  opts: { expiresIn?: string; secret?: Uint8Array } = {},
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? '1h')
    .sign(opts.secret ?? SECRET_BYTES);
}

describe('verifySupabaseJwt', () => {
  beforeEach(() => {
    vi.stubEnv('JWT_SECRET', TEST_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the userId (sub) for a valid token', async () => {
    const token = await makeToken({ sub: 'user-abc', email: 'a@b.com' });
    const result = await verifySupabaseJwt(token);
    expect(result.userId).toBe('user-abc');
    expect(result.email).toBe('a@b.com');
  });

  it('throws UnauthorizedError when signature is wrong', async () => {
    const wrongSecret = new TextEncoder().encode('completely-different-secret-32b');
    const token = await makeToken({ sub: 'user-abc' }, { secret: wrongSecret });
    await expect(verifySupabaseJwt(token)).rejects.toThrow(UnauthorizedError);
  });

  it('throws UnauthorizedError when token is expired', async () => {
    const token = await makeToken({ sub: 'user-abc' }, { expiresIn: '-1h' });
    await expect(verifySupabaseJwt(token)).rejects.toThrow(UnauthorizedError);
  });

  it('throws UnauthorizedError when sub claim is missing', async () => {
    const token = await makeToken({ email: 'a@b.com' });
    await expect(verifySupabaseJwt(token)).rejects.toThrow(UnauthorizedError);
  });

  it('throws UnauthorizedError when JWT_SECRET is not set', async () => {
    vi.stubEnv('JWT_SECRET', '');
    const token = await makeToken({ sub: 'user-abc' });
    await expect(verifySupabaseJwt(token)).rejects.toThrow(/JWT_SECRET/);
  });

  it('throws UnauthorizedError for malformed tokens', async () => {
    await expect(verifySupabaseJwt('not-a-jwt')).rejects.toThrow(UnauthorizedError);
  });
});
