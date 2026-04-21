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

  it('stamps every response with an X-Request-Id header', async () => {
    const res = await app.request('/v1/health');
    expect(res.status).toBe(200);
    const requestId = res.headers.get('X-Request-Id');
    expect(requestId).not.toBeNull();
    // UUID v4 shape (generated server-side)
    expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('echoes an inbound X-Request-Id instead of generating a new one', async () => {
    const clientId = '11111111-2222-3333-4444-555555555555';
    const res = await app.request('/v1/health', {
      headers: { 'X-Request-Id': clientId },
    });
    expect(res.headers.get('X-Request-Id')).toBe(clientId);
  });

  it('stamps the request id into error body meta for correlation', async () => {
    const res = await app.request('/v1/organizations');
    expect(res.status).toBe(401);
    const requestId = res.headers.get('X-Request-Id');
    expect(requestId).not.toBeNull();
    const body = (await res.json()) as { code: string; meta?: { requestId?: string } };
    expect(body.meta?.requestId).toBe(requestId);
  });
});
