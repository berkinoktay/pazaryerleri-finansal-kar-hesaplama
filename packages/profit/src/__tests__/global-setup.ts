import {
  ensureMicroExportReturnTiers,
  ensureShippingReferenceData,
} from '@pazarsync/db/test-support';

/**
 * vitest globalSetup for the profit integration suite.
 *
 * Seeds the shipping reference fixture (carriers + tariffs) once before the
 * suite. These tests look up the seeded SENDEOMP carrier to estimate return
 * shipping, and CI's `prisma db push` does NOT run migration seed SQL. The
 * helper is idempotent (prunes strays + fills gaps) and lives in @pazarsync/db,
 * next to the migration it reads. Mirrors apps/api's globalSetup so every
 * integration package starts from the same baseline regardless of cross-package
 * run order.
 *
 * Only the integration config (vitest.config.ts) wires this; unit tests use a
 * separate vitest.unit.config.ts with no DB. DB-unreachable is non-fatal — the
 * tests' own ensureDbReachable() gives a clearer signal than a globalSetup throw.
 */
export default async function globalSetup(): Promise<void> {
  if (process.env['PAZARSYNC_SKIP_RESEED'] === '1') return;
  try {
    await ensureShippingReferenceData();
    await ensureMicroExportReturnTiers();
  } catch (err) {
    console.warn(
      '⚠️  Shipping reference seed skipped (DB likely unreachable). ' +
        'Integration tests will fail if shipping_carriers is empty. ' +
        'Start Supabase (`supabase start`) and retry if this was unintentional.',
      err instanceof Error ? err.message : String(err),
    );
  }
}
