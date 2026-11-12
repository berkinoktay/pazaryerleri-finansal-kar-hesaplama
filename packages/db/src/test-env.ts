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

import { fileURLToPath } from 'node:url';

/** Env var carrying the base test DB URL (TEST_DATABASE_URL) to every worker. */
export const TEST_BASE_URL_ENV = 'PAZARSYNC_TEST_BASE_URL';
/** Env var carrying the per-package clone prefix (e.g. "api"). */
export const TEST_DB_PREFIX_ENV = 'PAZARSYNC_TEST_DB_PREFIX';
/** The shared dev database: never a template, never a clone source. */
const SHARED_DEV_DB_NAME = 'postgres';
/** The clone template lives next to the base test DB, never in it. */
const TEMPLATE_SUFFIX = '_tpl';
const CLONE_PREFIX_RE = /^[a-z]+$/;
const POOL_ID_RE = /^[1-9]\d*$/;

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
 * CI (`CI` set): the dev-DB guard is skipped (the per-job Supabase instance is
 * disposable). TEST_DATABASE_URL still has to name a separate database, because
 * `configureWorkerDatabases()` derives the clone template and the per-worker
 * clones from it and refuses the "postgres" database.
 *
 * `PAZARSYNC_SKIP_RESEED=1` also skips the guard; DB-free unit tests no longer
 * load these configs (they have their own vitest.unit.config.ts).
 *
 * The remapped DATABASE_URL is the BASE name only: integration configs call
 * `configureWorkerDatabases()` next, and each worker then runs against its own
 * clone of `<base>_tpl` (see test-db-clones.ts / test-worker-env.ts).
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

function withDatabaseName(url: string, name: string): string {
  const next = new URL(url);
  next.pathname = `/${name}`;
  return next.toString();
}

/** Name of the base test DB (TEST_DATABASE_URL); never the shared dev DB. */
function baseTestDbName(baseUrl: string): string {
  const name = extractDbName(baseUrl);
  if (name === SHARED_DEV_DB_NAME || name === '') {
    throw new Error(
      `Refusing to derive test databases from "${name}": TEST_DATABASE_URL must name the isolated test DB ` +
        '(e.g. pazarsync_test), never the shared "postgres" database. Set it and run `pnpm db:test-setup`.',
    );
  }
  return name;
}

/**
 * URL of the clone template: `<base>_tpl` next to the base test DB. Built and
 * sealed by `pnpm db:test-setup`; integration runs only ever clone it. Keeping
 * it apart from the base DB means a run of older code that still uses the base
 * DB directly can neither block a clone nor dirty the template.
 */
export function templateDatabaseUrl(baseUrl: string): string {
  return withDatabaseName(baseUrl, `${baseTestDbName(baseUrl)}${TEMPLATE_SUFFIX}`);
}

/**
 * URL of one worker's private clone of the template:
 * `<base>_<prefix>_w<poolId>` on the same server. Every vitest worker gets its
 * own clone, so `truncateAll` in one test file can never wipe the rows another
 * file is using, and files can run in parallel.
 */
export function workerDatabaseUrl(baseUrl: string, prefix: string, poolId: string): string {
  if (!CLONE_PREFIX_RE.test(prefix)) {
    throw new Error(`Test DB clone prefix must be lowercase letters only, got "${prefix}".`);
  }
  if (!POOL_ID_RE.test(poolId)) {
    throw new Error(`Vitest pool id must be a positive integer, got "${poolId}".`);
  }
  return withDatabaseName(baseUrl, `${baseTestDbName(baseUrl)}_${prefix}_w${poolId}`);
}

/** Same server, maintenance "postgres" database: where CREATE/DROP DATABASE run. */
export function adminDatabaseUrl(url: string): string {
  return withDatabaseName(url, SHARED_DEV_DB_NAME);
}

/** Exact names of a package's clones — the only databases the test setup may drop. */
export function cloneNamePattern(baseName: string, prefix: string): RegExp {
  const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}_${prefix}_w[1-9]\\d*$`);
}

export interface WorkerDatabaseWiring {
  /** globalSetup module: clones the template once per worker before the run. */
  globalSetup: string;
  /** setupFiles module: points each worker's DATABASE_URL at its clone. */
  setupFiles: string[];
}

/**
 * Wire an integration vitest config to per-worker database clones. Call at the
 * top of the config AFTER `remapDatabaseUrlToTestDb()`: it records the
 * remapped DATABASE_URL (the base test DB) and the package prefix in env vars
 * the forked workers inherit, and returns the globalSetup / setupFiles to add.
 */
export function configureWorkerDatabases(prefix: string): WorkerDatabaseWiring {
  const baseUrl = process.env['DATABASE_URL'];
  if (baseUrl === undefined || baseUrl.length === 0) {
    throw new Error(
      'configureWorkerDatabases: DATABASE_URL is not set (call it after the .env load and the remap).',
    );
  }
  // Fail at config load, not in the middle of the run.
  workerDatabaseUrl(baseUrl, prefix, '1');
  process.env[TEST_BASE_URL_ENV] = baseUrl;
  process.env[TEST_DB_PREFIX_ENV] = prefix;
  return {
    globalSetup: fileURLToPath(new URL('./test-db-clones.ts', import.meta.url)),
    setupFiles: [fileURLToPath(new URL('./test-worker-env.ts', import.meta.url))],
  };
}
