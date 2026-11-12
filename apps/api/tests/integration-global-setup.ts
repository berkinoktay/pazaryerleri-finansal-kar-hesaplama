import { purgeLeakedTestAuthUsers } from '@pazarsync/db/test-support';

/**
 * vitest globalSetup for the main api integration suite (the RLS suite keeps
 * tests/global-teardown.ts, because it runs against the dev DB).
 *
 * Every worker now runs against its own clone of the test DB template (see
 * @pazarsync/db test-db-clones), which is created fresh for the run and dropped
 * afterwards. That retired the old setup seeding (the fixtures live in the
 * template) and the teardown TRUNCATE + reference-data restore (nothing to
 * clean in a database that is about to be dropped).
 *
 * What remains is the DEV-DB auth purge: tests mint real `auth.users` rows via
 * GoTrue, which is bound to the dev "postgres" DB, so those rows (and the
 * `on_auth_user_created` trigger's orphan `user_profiles`) accumulate there.
 * The remap stashes the dev URL in PAZARSYNC_DEV_DATABASE_URL for this purge.
 * Skipped in CI (ephemeral database).
 */
export default function globalSetup(): () => Promise<void> {
  return async function teardown(): Promise<void> {
    if (process.env['CI'] !== undefined && process.env['CI'] !== '') return;
    const devUrl = process.env['PAZARSYNC_DEV_DATABASE_URL'];
    if (devUrl === undefined || devUrl.length === 0) return;
    try {
      const { authUsers, profiles } = await purgeLeakedTestAuthUsers(devUrl);
      if (authUsers > 0 || profiles > 0) {
        console.log(
          `Purged ${authUsers} test auth user(s) + ${profiles} orphan profile(s) from the dev DB`,
        );
      }
    } catch (err) {
      console.warn(
        '[teardown] dev-DB auth purge failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
  };
}
