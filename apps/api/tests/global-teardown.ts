import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { prisma } from '@pazarsync/db';

import { ensureShippingReferenceData } from './helpers/seed-shipping-reference';

const execFilePromise = promisify(execFile);

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
 * TEARDOWN half:
 *   Restore seed data so the developer's browser session (logged in
 *   as berkin / demo) sees the usual orgs and stores instead of the
 *   post-truncate empty state. Seed is idempotent (upsert + delete-
 *   then-create). Skipped in CI (no dev UI to hydrate) and when only
 *   unit tests ran (`pnpm test:unit` sets PAZARSYNC_SKIP_RESEED=1 —
 *   no DB was touched).
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  // Setup: shipping reference data. Skipped for unit-only runs (DB may
  // not even be reachable). Errors are non-fatal — integration tests
  // will surface a clearer signal than a globalSetup throw would.
  if (process.env['PAZARSYNC_SKIP_RESEED'] !== '1') {
    try {
      await ensureShippingReferenceData();
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
      // Mirrors `helpers/db.ts::truncateAll` — does NOT touch
      // `auth.users` or `user_profiles`. Wiping `user_profiles` here
      // would orphan any browser-signed-up developer's auth.users row
      // (P2003 on the next org-create attempt).  The seed step below
      // upserts the canonical profiles so dev UI still hydrates.
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

      const { stdout, stderr } = await execFilePromise('pnpm', ['-w', 'run', 'db:seed'], {
        cwd: process.cwd().replace(/\/apps\/api$/, ''),
      });
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
