import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { prisma } from '@pazarsync/db';

const execFilePromise = promisify(execFile);

/**
 * vitest `globalSetup` contract: the default export runs once before
 * the entire test run and may return a teardown function to be invoked
 * once after.
 *
 * We use it purely for the teardown half — restoring seed data so the
 * developer's browser session (logged in as berkin / demo) sees the
 * usual orgs and stores instead of the post-truncate empty state.
 *
 * Seed is idempotent (upsert + delete-then-create), so running it
 * against an already-hydrated DB is a no-op. Skipped in CI (no dev
 * UI to hydrate) and when only unit tests ran (`pnpm test:unit` sets
 * PAZARSYNC_SKIP_RESEED=1 — no DB was touched).
 */
export default function globalSetup(): () => Promise<void> {
  return async function teardown(): Promise<void> {
    if (process.env['CI'] !== undefined && process.env['CI'] !== '') return;
    if (process.env['PAZARSYNC_SKIP_RESEED'] === '1') return;

    try {
      // Wipe any leftover rows from the last test's `beforeEach`-less
      // aftermath (e.g. tenant-isolation tests leave "iso-a" / "iso-b"
      // orgs behind). Otherwise they accumulate run after run.
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
           organizations,
           user_profiles
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
