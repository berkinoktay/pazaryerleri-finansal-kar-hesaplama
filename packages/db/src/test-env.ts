// Integration-test database isolation. Dependency-free ON PURPOSE: every
// integration package's `vitest.config.ts` imports this right after loading the
// workspace-root `.env`, BEFORE the Prisma singleton (packages/db/src/index.ts)
// reads `DATABASE_URL` at import time. Importing anything here that pulls in the
// generated Prisma client would defeat that ordering, so this file only touches
// `process.env` and parses connection strings.
//
// Why: the whole integration suite TRUNCATEs ~29 tenant + reference tables in
// `beforeEach`. Pointing that at the shared dev DB wipes a developer's working
// data on every run. This remap redirects the suite at an ISOLATED test DB
// (`pnpm db:test-setup` bootstraps it) so the dev DB is never touched.

/**
 * Extract the database name from a Postgres connection URL (the last path
 * segment). Shared with `scripts/setup-test-db.ts` so the "never the dev DB"
 * guard has ONE implementation on both the bootstrap and the runtime gate.
 */
export function extractDbName(url: string): string {
  const { pathname } = new URL(url);
  return decodeURIComponent(pathname.replace(/^\//, '').replace(/\/$/, ''));
}

/**
 * Redirect the Prisma singleton at the isolated integration-test database.
 *
 * Call from a `vitest.config.ts` top level, immediately after `dotenv` has
 * loaded the workspace-root `.env`. The config module runs in vitest's parent
 * process; forked test workers inherit the mutated `process.env` at spawn time
 * (same mechanism the existing `dotenv` load already relies on).
 *
 * Local (CI unset), DB-touching run: `TEST_DATABASE_URL` is REQUIRED and MUST be
 * a database distinct from the dev DB — running the suite against the dev DB is
 * exactly what this prevents. Bootstrap (`pnpm db:test-setup`) is optional, so
 * this is the LAST line of defense before `truncateAll` wipes the dev DB; the
 * same two-part guard as the bootstrap (never "postgres", never the dev DB name)
 * is enforced here at runtime.
 *
 * CI (`CI` set): `TEST_DATABASE_URL` is optional and may equal `DATABASE_URL`.
 * CI already provisions a throwaway Supabase instance per job, so the per-job DB
 * is itself disposable; the guard is skipped and the remap is a harmless no-op
 * that keeps a single code path.
 *
 * DB-free unit run (`PAZARSYNC_SKIP_RESEED=1`): `apps/api`, `sync-worker` and
 * `sync-core` serve unit AND integration tests from one vitest config, so this
 * runs on unit runs too. Those never `truncateAll`, so `TEST_DATABASE_URL` is
 * not required and the guard is skipped.
 *
 * The pre-remap `DATABASE_URL` (the real dev DB) is stashed in
 * `PAZARSYNC_DEV_DATABASE_URL` so the apps/api global teardown can reach the dev
 * DB to purge the GoTrue-minted `@test.local` auth users: GoTrue is bound to the
 * "postgres" (dev) database and cannot be pointed elsewhere, so those rows only
 * ever land there, out of the test-DB Prisma singleton's reach.
 */
export function remapDatabaseUrlToTestDb(): void {
  const isCi = process.env['CI'] !== undefined && process.env['CI'] !== '';
  const isDbFreeRun = process.env['PAZARSYNC_SKIP_RESEED'] === '1';
  const testUrl = process.env['TEST_DATABASE_URL'];
  // Only a DB-touching LOCAL run needs (and is guarded for) an isolated DB.
  const requiresIsolatedDb = !isCi && !isDbFreeRun;

  if (requiresIsolatedDb && (testUrl === undefined || testUrl.length === 0)) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Integration tests no longer run against the ' +
        'shared dev database. Run `pnpm db:test-setup` to create and prepare the ' +
        'isolated test DB, then add TEST_DATABASE_URL to your workspace-root .env ' +
        '(e.g. postgresql://postgres:postgres@127.0.0.1:54322/pazarsync_test).',
    );
  }

  // CI without TEST_DATABASE_URL (or a DB-free unit run with none set): keep the
  // existing DATABASE_URL — nothing to remap.
  if (testUrl === undefined || testUrl.length === 0) return;

  const devUrl = process.env['DATABASE_URL'];

  // Safety gate — mirrors setup-test-db.ts. Enforced only for DB-touching local
  // runs (skipped in CI, where TEST_DATABASE_URL deliberately points at the
  // ephemeral per-job DB, and on DB-free unit runs, which never truncate). This
  // blocks the "copy-pasted DATABASE_URL into TEST_DATABASE_URL" footgun before
  // truncateAll can wipe the dev DB.
  if (requiresIsolatedDb) {
    const testName = extractDbName(testUrl);
    if (testName === 'postgres') {
      throw new Error(
        'TEST_DATABASE_URL points at the "postgres" database (the shared dev DB). ' +
          'The isolated test DB must be a SEPARATE database (e.g. pazarsync_test). ' +
          'Fix TEST_DATABASE_URL in your .env and run `pnpm db:test-setup`.',
      );
    }
    if (devUrl !== undefined && devUrl.length > 0 && extractDbName(devUrl) === testName) {
      throw new Error(
        `TEST_DATABASE_URL and DATABASE_URL point at the same database ("${testName}"). ` +
          'The integration suite TRUNCATEs ~29 tables, so the test DB MUST be separate ' +
          'from the dev DB. Fix TEST_DATABASE_URL in your .env (e.g. .../pazarsync_test) ' +
          'and run `pnpm db:test-setup`.',
      );
    }
  }

  // Stash the real dev URL BEFORE overwriting so teardown can reach the dev DB
  // (where GoTrue writes auth.users) for the @test.local purge.
  if (devUrl !== undefined && devUrl.length > 0) {
    process.env['PAZARSYNC_DEV_DATABASE_URL'] = devUrl;
  }

  process.env['DATABASE_URL'] = testUrl;
  process.env['DIRECT_URL'] = testUrl;
}
