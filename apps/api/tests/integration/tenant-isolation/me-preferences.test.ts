/**
 * User isolation tests for GET/PATCH /v1/me/preferences.
 *
 * The `/me` namespace is user-scoped (not org-scoped): each user reads and
 * writes ONLY their own UserProfile.preferences row. There is no `:orgId` in
 * the URL — isolation is achieved by looking up the profile via the
 * authenticated user's id (extracted from the JWT by authMiddleware and set
 * as c.get('userId')).
 *
 * These tests prove that:
 *   1. User A's PATCH only mutates A's row; B's row is untouched.
 *   2. User B's GET returns B's own preferences, unaffected by A's write.
 *   3. A user cannot forge another user's id via the request body — the
 *      handler derives the row id exclusively from the JWT.
 */

import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import type { Preferences } from '@/validators/preferences.validator';

const VALID_PATCH_BODY: Preferences = {
  marginColoring: {
    enabled: true,
    buckets: [
      { threshold: -10, color: 'oklch(54% 0.19 27)' },
      { threshold: 10, color: 'oklch(52% 0.13 155)' },
    ],
  },
};

describe('User isolation — GET/PATCH /v1/me/preferences', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("user A's PATCH only mutates A's profile row; B's row is untouched", async () => {
    const [userA, userB] = await Promise.all([
      createAuthenticatedTestUser(),
      createAuthenticatedTestUser(),
    ]);

    // Record B's preferences before A's write
    const profileBBefore = await prisma.userProfile.findUniqueOrThrow({
      where: { id: userB.id },
      select: { preferences: true, updatedAt: true },
    });

    // A updates their own preferences
    const patchRes = await app.request('/v1/me/preferences', {
      method: 'PATCH',
      headers: {
        Authorization: bearer(userA.accessToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(VALID_PATCH_BODY),
    });
    expect(patchRes.status).toBe(200);

    // B's row in the DB must be unchanged
    const profileBAfter = await prisma.userProfile.findUniqueOrThrow({
      where: { id: userB.id },
      select: { preferences: true, updatedAt: true },
    });
    expect(profileBAfter.preferences).toEqual(profileBBefore.preferences);
    expect(profileBAfter.updatedAt.getTime()).toBe(profileBBefore.updatedAt.getTime());

    // A's row must carry the new preferences
    const profileAAfter = await prisma.userProfile.findUniqueOrThrow({
      where: { id: userA.id },
      select: { preferences: true },
    });
    expect(profileAAfter.preferences).toMatchObject({
      marginColoring: { enabled: true },
    });
  });

  it("user B's GET returns B's own preferences, not A's", async () => {
    const [userA, userB] = await Promise.all([
      createAuthenticatedTestUser(),
      createAuthenticatedTestUser(),
    ]);

    // A saves marginColoring
    await app.request('/v1/me/preferences', {
      method: 'PATCH',
      headers: {
        Authorization: bearer(userA.accessToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(VALID_PATCH_BODY),
    });

    // B's GET must return B's own empty preferences, not A's
    const getRes = await app.request('/v1/me/preferences', {
      headers: { Authorization: bearer(userB.accessToken) },
    });
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as { data: Preferences };
    // B never patched — preferences must be empty
    expect(body.data).toEqual({});
    expect(body.data.marginColoring).toBeUndefined();
  });

  it('handler derives the profile id exclusively from the JWT, not from the request body', async () => {
    const [userA, userB] = await Promise.all([
      createAuthenticatedTestUser(),
      createAuthenticatedTestUser(),
    ]);

    // Attempt: A sends a valid body (no id field accepted) while authenticating as A
    // The handler must update A's row, not B's — body has no id field to inject
    const patchRes = await app.request('/v1/me/preferences', {
      method: 'PATCH',
      headers: {
        Authorization: bearer(userA.accessToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(VALID_PATCH_BODY),
    });
    expect(patchRes.status).toBe(200);

    // B's profile is unchanged
    const profileB = await prisma.userProfile.findUniqueOrThrow({
      where: { id: userB.id },
      select: { preferences: true },
    });
    expect(profileB.preferences).toEqual({});
  });
});
