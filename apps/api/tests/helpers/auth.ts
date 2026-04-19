import { randomUUID } from 'node:crypto';

import { prisma } from '@pazarsync/db';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const TEST_PASSWORD = 'integration-test-password';

let cachedAdminClient: SupabaseClient | undefined;
let cachedAnonClient: SupabaseClient | undefined;

function adminClient(): SupabaseClient {
  if (cachedAdminClient !== undefined) return cachedAdminClient;
  const url = process.env['SUPABASE_URL'];
  const secret = process.env['SUPABASE_SECRET_KEY'];
  if (url === undefined || url.length === 0 || secret === undefined || secret.length === 0) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SECRET_KEY must be set for createAuthenticatedTestUser. ' +
        'Check workspace-root .env or the CI job env block.',
    );
  }
  cachedAdminClient = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedAdminClient;
}

function anonClient(): SupabaseClient {
  if (cachedAnonClient !== undefined) return cachedAnonClient;
  const url = process.env['SUPABASE_URL'];
  const publishable = process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];
  if (
    url === undefined ||
    url.length === 0 ||
    publishable === undefined ||
    publishable.length === 0
  ) {
    throw new Error(
      'SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set for createAuthenticatedTestUser.',
    );
  }
  cachedAnonClient = createClient(url, publishable, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedAnonClient;
}

export interface AuthenticatedTestUser {
  id: string;
  email: string;
  accessToken: string;
}

/**
 * Create a real Supabase Auth user + matching user_profiles row, then sign in
 * to obtain a real access token. The token is a genuine Supabase-issued JWT,
 * so auth middleware exercises the same verification path as production.
 *
 * Every call produces a fresh user (randomised email) — no cleanup needed
 * for correctness because auth.users rows from previous tests don't collide.
 */
export async function createAuthenticatedTestUser(
  overrides: { email?: string; fullName?: string } = {},
): Promise<AuthenticatedTestUser> {
  const email = overrides.email ?? `test-${randomUUID()}@test.local`;
  const admin = adminClient();
  const anon = anonClient();

  const { data: createData, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (createErr !== null || createData.user === null) {
    throw new Error(`admin.createUser failed: ${createErr?.message ?? 'no user returned'}`);
  }
  const userId = createData.user.id;

  const { data: signInData, error: signInErr } = await anon.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (signInErr !== null || signInData.session === null) {
    throw new Error(`signInWithPassword failed: ${signInErr?.message ?? 'no session returned'}`);
  }

  await prisma.userProfile.upsert({
    where: { id: userId },
    update: { email, fullName: overrides.fullName ?? 'Test User' },
    create: { id: userId, email, fullName: overrides.fullName ?? 'Test User' },
  });

  return {
    id: userId,
    email,
    accessToken: signInData.session.access_token,
  };
}

/**
 * Convenience — construct a Bearer Authorization header value.
 */
export function bearer(token: string): string {
  return `Bearer ${token}`;
}
