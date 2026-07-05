/**
 * Cursor into the reusable authenticated-test-user pool, isolated in its own
 * ZERO-IMPORT module ON PURPOSE.
 *
 * `db.ts` needs to rewind this cursor from `truncateAll` (the de-facto per-test
 * boundary). If it imported it from `auth.ts`, the whole `auth.ts` module graph
 * — including its `@/lib/supabase-admin-client` alias import — would be pulled
 * into every consumer that imports `db.ts`. Packages OUTSIDE apps/api
 * (`@pazarsync/sync-core`, `apps/sync-worker`) import `truncateAll` from
 * `db.ts` via a relative path, and their vitest configs don't know the `@/`
 * alias, so that transitive edge died with ERR_MODULE_NOT_FOUND in CI (#403).
 * Keeping the cursor here — with no imports at all — means `db.ts` never
 * touches `auth.ts`, so nothing but apps/api's own tests ever resolves the
 * alias. The pool array itself stays in `auth.ts`; only the cursor is shared.
 */
let cursor = 0;

/**
 * Reserve the next pool slot: return the current cursor index, then advance.
 *
 * `createAuthenticatedTestUser` (auth.ts) uses the returned index to decide
 * whether to reuse `pool[index]` or mint a fresh user, so consecutive calls
 * WITHIN a single test get DISTINCT slots (multi-tenancy isolation tests that
 * mint two users stay correct).
 */
export function nextPoolIndex(): number {
  return cursor++;
}

/**
 * Rewind the reusable-user cursor to the start of the pool.
 *
 * Called by `truncateAll` (tests/helpers/db.ts) at the end of every run —
 * `truncateAll` is the de-facto per-test boundary (every DB test invokes it in
 * `beforeEach`). After a rewind the next test again hands out `pool[0]`,
 * `pool[1]`, … so consecutive calls WITHIN a single test still get DISTINCT
 * users, while the users themselves are reused ACROSS tests. The pool array is
 * never cleared: the `auth.users` / `user_profiles` rows it points at live
 * outside `truncateAll`'s scope and stay valid for the whole run.
 */
export function resetAuthUserPoolCursor(): void {
  cursor = 0;
}
