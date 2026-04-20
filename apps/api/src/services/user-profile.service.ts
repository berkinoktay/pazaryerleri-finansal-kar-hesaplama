import { prisma } from '@pazarsync/db';

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
