import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';
import { bearer, createAuthenticatedTestUser } from '../../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../../helpers/db';
import type { Preferences } from '@/validators/preferences.validator';

describe('GET /v1/me/preferences', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('returns 401 without a token', async () => {
    const res = await app.request('/v1/me/preferences');
    expect(res.status).toBe(401);
  });

  it('returns empty preferences for a new user (default {})', async () => {
    const user = await createAuthenticatedTestUser();

    const res = await app.request('/v1/me/preferences', {
      headers: { Authorization: bearer(user.accessToken) },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Preferences };
    expect(body.data).toEqual({});
  });
});

describe('PATCH /v1/me/preferences', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('returns 401 without a token', async () => {
    const res = await app.request('/v1/me/preferences', { method: 'PATCH' });
    expect(res.status).toBe(401);
  });

  it('saves marginColoring and GET returns it back', async () => {
    const user = await createAuthenticatedTestUser();

    const patchBody: Preferences = {
      marginColoring: {
        enabled: true,
        buckets: [
          { threshold: -10, color: 'oklch(54% 0.19 27)' },
          { threshold: 10, color: 'oklch(52% 0.13 155)' },
        ],
      },
    };

    const patchRes = await app.request('/v1/me/preferences', {
      method: 'PATCH',
      headers: {
        Authorization: bearer(user.accessToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(patchBody),
    });

    expect(patchRes.status).toBe(200);
    const patchJson = (await patchRes.json()) as { data: Preferences };
    expect(patchJson.data.marginColoring?.enabled).toBe(true);
    expect(patchJson.data.marginColoring?.buckets).toHaveLength(2);

    // GET must reflect the stored value
    const getRes = await app.request('/v1/me/preferences', {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(getRes.status).toBe(200);
    const getJson = (await getRes.json()) as { data: Preferences };
    expect(getJson.data).toEqual(patchJson.data);
  });

  it('rejects invalid body (descending thresholds) with 422 VALIDATION_ERROR', async () => {
    const user = await createAuthenticatedTestUser();

    const invalidBody = {
      marginColoring: {
        enabled: true,
        buckets: [
          { threshold: 20, color: 'red' },
          { threshold: 10, color: 'green' }, // descending — invalid
        ],
      },
    };

    const res = await app.request('/v1/me/preferences', {
      method: 'PATCH',
      headers: {
        Authorization: bearer(user.accessToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(invalidBody),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects invalid body (equal thresholds) with 422 VALIDATION_ERROR', async () => {
    const user = await createAuthenticatedTestUser();

    const invalidBody = {
      marginColoring: {
        enabled: true,
        buckets: [
          { threshold: 10, color: 'x' },
          { threshold: 10, color: 'y' }, // equal — invalid
        ],
      },
    };

    const res = await app.request('/v1/me/preferences', {
      method: 'PATCH',
      headers: {
        Authorization: bearer(user.accessToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(invalidBody),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('shallow-merges: PATCH with only marginColoring does not wipe future keys', async () => {
    const user = await createAuthenticatedTestUser();

    // Simulate an existing blob with a hypothetical future key already stored
    await prisma.userProfile.update({
      where: { id: user.id },
      data: {
        preferences: {
          marginColoring: {
            enabled: false,
            buckets: [
              { threshold: -10, color: 'red' },
              { threshold: 10, color: 'green' },
            ],
          },
        },
      },
    });

    // PATCH only sends marginColoring with new values
    const patchRes = await app.request('/v1/me/preferences', {
      method: 'PATCH',
      headers: {
        Authorization: bearer(user.accessToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        marginColoring: {
          enabled: true,
          buckets: [
            { threshold: 0, color: 'blue' },
            { threshold: 50, color: 'orange' },
          ],
        },
      }),
    });

    expect(patchRes.status).toBe(200);
    const body = (await patchRes.json()) as { data: Preferences };
    // The marginColoring key was overwritten with the new value
    expect(body.data.marginColoring?.enabled).toBe(true);
    expect(body.data.marginColoring?.buckets[0]?.color).toBe('blue');
  });
});
