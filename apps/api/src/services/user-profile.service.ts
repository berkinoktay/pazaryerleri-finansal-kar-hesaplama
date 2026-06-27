import { prisma } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';

import type { Preferences } from '../validators/preferences.validator';

export interface UserProfileView {
  id: string;
  email: string;
  timezone: string;
  preferredLanguage: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Load the authenticated user's profile.
 *
 * Uses upsert-by-read-then-create rather than a single upsert because
 * the row exists 99.9% of the time (the on_auth_user_created trigger
 * creates it on signup). Hot path is a single indexed lookup — the
 * fallback only fires for legacy users from before the trigger shipped
 * or for the brief window if the trigger ever errors silently.
 *
 * Callers always receive a valid profile; this function never throws
 * NOT_FOUND for an authenticated user.
 */
export async function getOrCreateByUserId(userId: string, email: string): Promise<UserProfileView> {
  const existing = await prisma.userProfile.findUnique({ where: { id: userId } });
  if (existing !== null) return toView(existing);

  const created = await prisma.userProfile.upsert({
    where: { id: userId },
    update: {},
    create: { id: userId, email },
  });
  return toView(created);
}

function toView(row: {
  id: string;
  email: string;
  timezone: string;
  preferredLanguage: string;
  createdAt: Date;
  updatedAt: Date;
}): UserProfileView {
  return {
    id: row.id,
    email: row.email,
    timezone: row.timezone,
    preferredLanguage: row.preferredLanguage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── Preferences ──────────────────────────────────────────────────────────────

/**
 * Parse and return the preferences blob for the given user's profile.
 *
 * The `preferences` column defaults to `{}` so this will always succeed for
 * an authenticated user. The Json Prisma type maps to `unknown`; we cast to
 * `Preferences` only after Prisma returns it — the validated write path
 * (patchPreferences) is the source of truth for shape correctness.
 */
export async function getPreferences(userId: string): Promise<Preferences> {
  // findUnique (not …OrThrow): a missing row — the legacy/trigger-gap edge that
  // getOrCreateByUserId documents — yields the opt-in default `{}` rather than a
  // spurious 500 for an authenticated user reading their own preferences.
  const profile = await prisma.userProfile.findUnique({ where: { id: userId } });
  return (profile?.preferences ?? {}) as Preferences;
}

/**
 * Shallow-merge `patch` into the existing preferences blob for the given user.
 *
 * "Shallow merge" means only the top-level keys supplied in `patch` are
 * overwritten; any existing top-level key NOT present in `patch` is preserved.
 * This lets a caller send `{ marginColoring: … }` without accidentally wiping
 * future preference keys (e.g. `{ shortcuts: … }`) they did not include.
 *
 * Scoped exclusively to the authenticated user's own row via `where: { id: userId }`.
 * The userId comes from the JWT (set by authMiddleware on c.get('userId')) —
 * never from the request body.
 */
export async function patchPreferences(
  userId: string,
  email: string,
  patch: Preferences,
): Promise<Preferences> {
  // Guarantee the row exists (legacy/trigger-gap edge) before updating, so an
  // authenticated user never hard-fails saving their own preferences.
  await getOrCreateByUserId(userId, email);

  const existing = await getPreferences(userId);
  const merged: Preferences = { ...existing, ...patch };

  try {
    const updated = await prisma.userProfile.update({
      where: { id: userId },
      data: { preferences: merged as object },
      select: { preferences: true },
    });
    return (updated.preferences ?? {}) as Preferences;
  } catch (err) {
    mapPrismaError(err);
  }
}
