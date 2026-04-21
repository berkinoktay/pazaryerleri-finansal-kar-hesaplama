import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';
import { bearer, createAuthenticatedTestUser } from '../helpers/auth';
import { ensureDbReachable, truncateAll } from '../helpers/db';

describe('Error response shape', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('emits VALIDATION_ERROR ProblemDetails for a too-short org name', async () => {
    const user = await createAuthenticatedTestUser();

    const res = await app.request('/v1/organizations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer(user.accessToken),
      },
      body: JSON.stringify({ name: 'A' }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      type: string;
      title: string;
      status: number;
      code: string;
      errors: Array<{ field: string; code: string }>;
    };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.status).toBe(422);
    expect(body.errors).toHaveLength(1);
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'name', code: 'INVALID_NAME_TOO_SHORT' }),
      ]),
    );
  });

  it('emits VALIDATION_ERROR ProblemDetails for a reserved org name', async () => {
    const user = await createAuthenticatedTestUser();

    const res = await app.request('/v1/organizations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer(user.accessToken),
      },
      body: JSON.stringify({ name: 'admin' }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; errors: Array<{ code: string }> };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors.map((e) => e.code)).toContain('INVALID_NAME_RESERVED');
  });

  it('emits UNAUTHENTICATED ProblemDetails without a token', async () => {
    const res = await app.request('/v1/organizations');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('UNAUTHENTICATED');
  });
});
