import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { prisma } from '@pazarsync/db';
import {
  ensureMicroExportReturnTiers,
  ensureShippingReferenceData,
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
 *   Always TRUNCATE leftover tenant rows AND purge leaked `@test.local`
 *   auth users — integration tests mint real `auth.users` rows that
 *   `truncateAll` never touches (feedback_tests_dont_wipe_seed), so without
 *   this they accumulate unboundedly (hit ~35k once). The post-test re-seed
 *   that re-hydrates the dev UI (berkin / demo orgs + stores) is now OPT-IN
 *   via PAZARSYNC_RESEED_AFTER_TESTS=1; by default the DB is left clean.
 *   Skipped entirely in CI (no dev UI) and on unit-only runs (`pnpm test:unit`
 *   sets PAZARSYNC_SKIP_RESEED=1 — no DB was touched).
 *
 *   REFERENCE DATA RESTORE (always, locally):
 *     `truncateAll` wipes `fee_definitions` and `marketplace_commission_rate`
 *     on purpose — RLS/list tests assert exact reference-row counts and need
 *     an empty slate per test (see fee-definitions.rls.test.ts, which creates
 *     2 rows and expects to read back exactly 2). But those tables are NOT
 *     tenant data: the same rows service every seller, and the live dev app
 *     reads them on every ORDERS sync. After a test run wiped them, the dev
 *     app's sync broke with `No active FeeDefinition for TRENDYOL/
 *     COMMISSION_INVOICE` until someone re-ran `pnpm db:seed-reference` by
 *     hand. So we restore the reference catalog here, unconditionally, by
 *     shelling out to the canonical seed-reference script (single source of
 *     truth — same buckets as `pnpm db:seed-reference`). This is independent
 *     of the opt-in dev-UI reseed: reference data is parameter data the live
 *     app always needs, not tenant residue. Skipped in CI (ephemeral DB) and
 *     on unit-only runs (no DB touched).
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
      // Wipe any leftover rows from the last test's `beforeEach`-less
      // aftermath (e.g. tenant-isolation tests leave "iso-a" / "iso-b"
      // orgs behind). Otherwise they accumulate run after run.
      //
      // Does NOT touch `user_profiles` — wiping it would orphan a
      // browser-signed-up developer's auth.users row (P2003 on the next
      // org-create attempt).
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

      // Purge leaked test auth users. `createAuthenticatedTestUser` mints real
      // Supabase `auth.users` rows (`test-<uuid>@test.local`) and the
      // `createUserProfile` factory uses `<uuid>@test.local`. `truncateAll`
      // never touches `auth.users` (feedback_tests_dont_wipe_seed), so they
      // accumulate run after run (hit ~35k once). Pattern-scoped to
      // `@test.local` → real logins (gmail, `demo@pazarsync.local`) never match.
      const purged = await prisma.$executeRawUnsafe(
        `DELETE FROM auth.users WHERE email LIKE '%@test.local'`,
      );
      if (purged > 0) console.log(`Purged ${purged} test auth user(s)`);

      // Restore the reference/parameter catalog (fee_definitions +
      // marketplace_commission_rate) that `truncateAll` wiped during the run.
      // These are NOT tenant data — the live dev app reads them on every
      // ORDERS sync, and a wiped table breaks sync with `No active
      // FeeDefinition for TRENDYOL/COMMISSION_INVOICE`. Always restore
      // (independent of the opt-in dev-UI reseed below). Single source of
      // truth: the same script `pnpm db:seed-reference` runs, which is
      // idempotent (delete+insert per bucket) and skips missing snapshots.
      await restoreReferenceData();

      // Clean-by-default: the post-test re-seed (demo orgs / stores / products)
      // is residue most runs do not want. Opt in with
      // PAZARSYNC_RESEED_AFTER_TESTS=1 when the dev UI should be hydrated.
      if (process.env['PAZARSYNC_RESEED_AFTER_TESTS'] !== '1') return;

      // `--with-sample` because `db:seed` is clean-by-default (a no-op without
      // it); the opt-in reseed wants the full dev-UI hydration.
      const { stdout, stderr } = await execFilePromise(
        'pnpm',
        ['--filter', '@pazarsync/db', 'seed', '--with-sample'],
        { cwd: process.cwd().replace(/\/apps\/api$/, '') },
      );
      const lastLines = stdout.trim().split('\n').slice(-5).join('\n');
      console.log(`\n\u2713 Post-test re-seed:\n${lastLines}`);
      if (stderr.trim() !== '') console.warn('[teardown] stderr:', stderr);
    } catch (err) {
      console.warn(
        '\u26a0\ufe0f  Post-test re-seed failed. Run `pnpm db:seed` manually if you plan to use the dev UI.',
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      await prisma.$disconnect();
    }
  };
}
