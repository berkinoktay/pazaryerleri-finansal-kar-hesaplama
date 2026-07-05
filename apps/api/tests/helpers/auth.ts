import { randomUUID } from 'node:crypto';

import { prisma } from '@pazarsync/db';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseAdminClient } from '@/lib/supabase-admin-client';

const TEST_PASSWORD = 'integration-test-password';
// The one profile field a reused user must keep pinned to the TEST convention
// (the schema default for `full_name` is NULL, but mint sets 'Test User', so a
// reused profile has to match). Every OTHER column is restored to its schema
// default by delete+recreate — see resetPooledProfile.
const DEFAULT_TEST_FULL_NAME = 'Test User';

let cachedAnonClient: SupabaseClient | undefined;

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
 * Truncate-bounded pool of reusable authenticated test users, plus the cursor
 * into it. Minting a user is the suite's #2 setup cost: two GoTrue round-trips
 * (admin.createUser + signInWithPassword, ~180ms) per call, ~25% of the
 * integration suite. The pool amortises that — `auth.users` rows survive
 * `truncateAll` (it only wipes tenant tables), so a user minted once stays a
 * valid login for the whole vitest run and can be handed back to a later test.
 *
 * This module-level pool staying correct relies on vitest's default
 * `isolate: true`: each test file runs in its own module registry, so the pool
 * (and its cursor) is fresh per file and never outlives a single file's run.
 * Flipping `isolate: false` would share one pool across files and silently
 * break both the per-run token-age guarantee (a token could outlive its 1h TTL
 * across many files) and the pool-growth bound — do not change it.
 */
const pool: AuthenticatedTestUser[] = [];
let cursor = 0;

/**
 * Rewind the reusable-user cursor to the start of the pool.
 *
 * Called by `truncateAll` (tests/helpers/db.ts) at the end of every run —
 * `truncateAll` is the de-facto per-test boundary (every DB test invokes it in
 * `beforeEach`). After a rewind the next test again hands out `pool[0]`,
 * `pool[1]`, … so consecutive calls WITHIN a single test still get DISTINCT
 * users (multi-tenancy isolation tests stay correct), while the users
 * themselves are reused ACROSS tests. The pool array is never cleared: the
 * `auth.users` / `user_profiles` rows it points at live outside `truncateAll`'s
 * scope and stay valid for the whole run.
 */
export function resetAuthUserPoolCursor(): void {
  cursor = 0;
}

/**
 * Mint a brand-new Supabase Auth user + matching `user_profiles` row and sign
 * in to obtain a real access token (a genuine Supabase-issued JWT, so auth
 * middleware runs the same verification path as production). This is the slow
 * path behind `createAuthenticatedTestUser`'s pool.
 */
async function mintAuthenticatedTestUser(overrides: {
  email?: string;
  fullName?: string;
}): Promise<AuthenticatedTestUser> {
  const email = overrides.email ?? `test-${randomUUID()}@test.local`;
  const admin = getSupabaseAdminClient();
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
    update: { email, fullName: overrides.fullName ?? DEFAULT_TEST_FULL_NAME },
    create: { id: userId, email, fullName: overrides.fullName ?? DEFAULT_TEST_FULL_NAME },
  });

  return {
    id: userId,
    email,
    accessToken: signInData.session.access_token,
  };
}

/**
 * Reset a reused pooled user's `user_profiles` row to the exact state a freshly
 * minted user would have. `truncateAll` deliberately leaves `user_profiles`
 * alone (so pooled logins survive), which means ANY column a prior test wrote —
 * `preferences` via /me/preferences, `timezone` / `preferred_language` via the
 * RLS test — would otherwise leak into the next reuse.
 *
 * Mechanism is delete-then-recreate, NOT a column-by-column upsert, ON PURPOSE:
 * recreating the row makes Postgres reapply the schema DEFAULT for every column
 * we don't name, so a new mutable column added to `UserProfile` tomorrow can't
 * silently start leaking — it comes back clean automatically. Only `fullName`
 * is set explicitly, because 'Test User' is a test convention, not the schema
 * default (which is NULL). `deleteMany` (not `delete`) is a safe no-op if a
 * CASCADE already removed the row. Safe to delete: `truncateAll` (beforeEach)
 * has already wiped `organization_members`, and the pooled user has no
 * membership yet at the moment it is handed out, so nothing FKs to the row.
 */
async function resetPooledProfile(user: AuthenticatedTestUser): Promise<void> {
  await prisma.userProfile.deleteMany({ where: { id: user.id } });
  await prisma.userProfile.create({
    data: { id: user.id, email: user.email, fullName: DEFAULT_TEST_FULL_NAME },
  });
}

/**
 * Return a real authenticated test user (id + email + genuine access token).
 *
 * **Pool semantics** (the default, no-overrides path):
 *   - Consecutive calls WITHIN a single test return DIFFERENT users — the
 *     cursor advances on each call — so multi-tenancy isolation tests that mint
 *     two users to prove they can't see each other's data stay correct.
 *   - ACROSS tests the SAME users are reused: `truncateAll` rewinds the cursor
 *     (via `resetAuthUserPoolCursor`) but never touches `auth.users`, so a token
 *     minted in test 1 is still valid in test 2 (Supabase JWTs live 1h; the
 *     whole suite runs in ~7 min, so a pooled token never expires mid-run). Any
 *     tenant state a reused user accumulated lives in tenant tables that
 *     `truncateAll` wipes, so each test still sees a clean slate.
 *   - The `user_profiles` row is reset to a full clean baseline on EVERY reuse
 *     (see `resetPooledProfile`): `truncateAll` does NOT wipe `user_profiles`,
 *     so any column a prior test mutated (`preferences` via /me/preferences,
 *     `timezone` / `preferred_language` via the RLS test) would otherwise leak
 *     into the next test that reuses the same physical user — under concurrent
 *     mint the pool order isn't fixed, so a patched user can resurface as a
 *     different test's "untouched" user. The reset (a delete+create, two
 *     statements) replaces the two GoTrue round-trips (~180ms) for the ~90% of
 *     calls served from the pool.
 *
 * **Opt-out**: passing `overrides.email` OR `overrides.fullName` bypasses the
 * pool and mints a throwaway user with that identity — a test asserting on a
 * specific email/full name must not have it reused (or observed) by a later
 * test, and gets the original fresh-user behaviour verbatim.
 */
export async function createAuthenticatedTestUser(
  overrides: { email?: string; fullName?: string } = {},
): Promise<AuthenticatedTestUser> {
  // Custom-identity callers never touch the pool — see JSDoc "Opt-out".
  if (overrides.email !== undefined || overrides.fullName !== undefined) {
    return mintAuthenticatedTestUser(overrides);
  }

  // Reuse a pooled user while the cursor points inside the pool. The profile
  // row is reset to a clean baseline; the token is handed back as-is.
  const pooled = cursor < pool.length ? pool[cursor] : undefined;
  if (pooled !== undefined) {
    cursor += 1;
    await resetPooledProfile(pooled);
    return pooled;
  }

  // Pool exhausted for this test — mint a fresh user, remember it, advance.
  const user = await mintAuthenticatedTestUser(overrides);
  pool.push(user);
  cursor += 1;
  return user;
}

/**
 * Convenience — construct a Bearer Authorization header value.
 */
export function bearer(token: string): string {
  return `Bearer ${token}`;
}
