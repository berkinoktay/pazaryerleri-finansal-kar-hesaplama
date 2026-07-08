import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { prisma } from '@pazarsync/db';
import {
  ensureMicroExportReturnTiers,
  ensureShippingReferenceData,
  purgeLeakedTestAuthUsers,
} from '@pazarsync/db/test-support';

const execFilePromise = promisify(execFile);

/**
 * Re-hydrate the reference/parameter catalog by invoking the canonical
 * `pnpm db:seed-reference` script (single source of truth). Idempotent:
 * each loader does delete+insert per (platform, ruleKind) bucket and skips
 * any snapshot file that isn't present, so it's safe to run on every local
 * teardown. Throws are caught by the teardown's try/catch — a failed
 * restore must not mask test results, but the warning tells the developer
 * to run `pnpm db:seed-reference` by hand.
 */
async function restoreReferenceData(): Promise<void> {
  const repoRoot = process.cwd().replace(/\/apps\/api$/, '');
  const { stdout, stderr } = await execFilePromise(
    'pnpm',
    ['--filter', '@pazarsync/db', 'seed:reference'],
    { cwd: repoRoot },
  );
  const lastLines = stdout.trim().split('\n').slice(-4).join('\n');
  console.log(`\n✓ Reference data restored:\n${lastLines}`);
  if (stderr.trim() !== '') console.warn('[teardown] seed:reference stderr:', stderr);
}

/**
 * vitest `globalSetup` contract: the default export runs once before
 * the entire test run and may return a teardown function to be invoked
 * once after.
 *
 * SETUP half:
 *   Ensure shipping reference data (carriers + tariffs + Barem tiers)
 *   exists. CI runs `prisma db push` which does NOT execute migration
 *   SQL, so the seed INSERTs in migration 20260517085409_shipping_tariffs
 *   never land. Tests that depend on the global tariff catalog (every
 *   shipping integration test) would otherwise fail with "expected
 *   length 10 but got 0" in CI. The helper is idempotent — local devs
 *   who already ran `prisma migrate dev` see a fast no-op.
 *
 * TEARDOWN half (clean-by-default):
 *   The main integration suite is remapped at the ISOLATED test DB (see
 *   packages/db/src/test-env.ts), so `prisma` here is bound to the test DB, NOT
 *   the dev DB. Three independent, isolated steps run (a failure in one must not
 *   skip the others):
 *
 *   (1) TRUNCATE leftover tenant rows in the test DB — tenant-isolation tests
 *       leave "iso-a"/"iso-b" orgs behind with no `beforeEach` after them.
 *
 *   (2) REFERENCE DATA RESTORE: `truncateAll` wipes `fee_definitions` and
 *       `marketplace_commission_rate` on purpose — RLS/list tests assert exact
 *       reference-row counts and need an empty slate per test (see
 *       fee-definitions.rls.test.ts). Those tables are NOT tenant data (the same
 *       rows service every seller), so we restore them via the canonical
 *       `pnpm db:seed-reference` script. The shell-out inherits the remapped env,
 *       so it restores the test DB in the main run and the dev DB in the
 *       (un-remapped) RLS run — both need it back.
 *
 *   (3) DEV-DB AUTH PURGE: integration tests mint real `auth.users` rows via
 *       GoTrue, which is bound to the dev "postgres" DB and cannot be pointed at
 *       the test DB — so those rows (and the `on_auth_user_created` trigger's
 *       orphan `user_profiles`) accumulate in the DEV DB, out of the test-DB
 *       Prisma singleton's reach (they once hit ~35k). We purge them with a
 *       separate connection to the pre-remap dev URL (PAZARSYNC_DEV_DATABASE_URL,
 *       stashed by the remap; the un-remapped RLS run falls back to DATABASE_URL,
 *       already the dev DB).
 *
 *   The old PAZARSYNC_RESEED_AFTER_TESTS dev-UI reseed hook was REMOVED: the main
 *   suite no longer wipes the dev DB, so there is nothing to re-hydrate. The RLS
 *   suite does still run against the dev DB — if it empties the dev tenant data
 *   you want back, run `pnpm db:seed --with-sample` by hand.
 *
 *   Skipped entirely in CI (ephemeral DB) and on unit-only runs (`pnpm test:unit`
 *   sets PAZARSYNC_SKIP_RESEED=1 — no DB was touched).
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  // Setup: shipping reference data. Skipped for unit-only runs (DB may
  // not even be reachable). Errors are non-fatal — integration tests
  // will surface a clearer signal than a globalSetup throw would.
  if (process.env['PAZARSYNC_SKIP_RESEED'] !== '1') {
    try {
      await ensureShippingReferenceData();
      await ensureMicroExportReturnTiers();
    } catch (err) {
      console.warn(
        '⚠️  Shipping reference seed skipped (DB likely unreachable). ' +
          'Integration tests will fail if shipping_carriers is empty. ' +
          'Start Supabase (`supabase start`) and try again if this was unintentional.',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return async function teardown(): Promise<void> {
    if (process.env['CI'] !== undefined && process.env['CI'] !== '') return;
    if (process.env['PAZARSYNC_SKIP_RESEED'] === '1') return;

    try {
      // (1) Wipe any leftover rows from the last test's `beforeEach`-less
      // aftermath (e.g. tenant-isolation tests leave "iso-a" / "iso-b" orgs
      // behind) from the TEST DB (prisma is remapped there). Does NOT touch
      // `user_profiles` — wiping it would orphan a browser-signed-up developer's
      // auth.users row (P2003 on the next org-create attempt). Isolated so a
      // failure here never skips the restore/purge steps below.
      try {
        await prisma.$executeRawUnsafe(
          `TRUNCATE TABLE
             sync_logs,
             settlement_items,
             settlements,
             order_items,
             orders,
             products,
             expenses,
             stores,
             organization_members,
             organizations
           RESTART IDENTITY CASCADE`,
        );
      } catch (err) {
        console.warn(
          '[teardown] tenant TRUNCATE failed:',
          err instanceof Error ? err.message : String(err),
        );
      }

      // (2) Re-prime the reference/parameter catalog (fee_definitions +
      // marketplace_commission_rate) that `truncateAll` wiped during the run, so
      // the NEXT run starts from the canonical reference baseline instead of an
      // empty slate. The shell-out inherits the remapped env, so it targets the
      // TEST DB in the main run (the dev DB is untouched by the main suite) and
      // the dev DB in the un-remapped RLS run. Isolated so a purge failure never
      // leaves reference data missing (single source of truth:
      // `pnpm db:seed-reference`, idempotent).
      try {
        await restoreReferenceData();
      } catch (err) {
        console.warn(
          'Reference restore failed. Run `pnpm db:seed-reference` manually.',
          err instanceof Error ? err.message : String(err),
        );
      }

      // (3) Purge the `@test.local` auth users GoTrue minted in the DEV DB (and
      // the `on_auth_user_created` trigger's orphan `user_profiles`). GoTrue only
      // ever writes the dev "postgres" DB, so this needs a separate connection to
      // the pre-remap dev URL (PAZARSYNC_DEV_DATABASE_URL); the RLS run is not
      // remapped, so fall back to DATABASE_URL (already the dev DB). Without this
      // the rows accumulate run after run (hit ~35k once).
      try {
        const devUrl = process.env['PAZARSYNC_DEV_DATABASE_URL'] ?? process.env['DATABASE_URL'];
        if (devUrl !== undefined && devUrl.length > 0) {
          const { authUsers, profiles } = await purgeLeakedTestAuthUsers(devUrl);
          if (authUsers > 0 || profiles > 0) {
            console.log(
              `Purged ${authUsers} test auth user(s) + ${profiles} orphan profile(s) from the dev DB`,
            );
          }
        }
      } catch (err) {
        console.warn(
          '[teardown] dev-DB auth purge failed:',
          err instanceof Error ? err.message : String(err),
        );
      }
    } finally {
      await prisma.$disconnect();
    }
  };
}
