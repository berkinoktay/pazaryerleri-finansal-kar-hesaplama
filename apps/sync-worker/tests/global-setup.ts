import {
  ensureMicroExportReturnTiers,
  ensureShippingReferenceData,
} from '@pazarsync/db/test-support';

/**
 * vitest globalSetup for the sync-worker test run.
 *
 * Seeds the shipping reference fixture (carriers + tariffs) once before tests.
 * The claims return-estimate handler looks up the seeded SENDEOMP carrier, and
 * CI's `prisma db push` does NOT run migration seed SQL. The helper is
 * idempotent (prunes strays + fills gaps) and lives in @pazarsync/db. Mirrors
 * apps/api's globalSetup so every integration package starts from the same
 * baseline regardless of cross-package run order.
 *
 * sync-worker's unit + integration tests share one vitest config, so the
 * `test:unit` script sets PAZARSYNC_SKIP_RESEED=1 to skip the DB touch (mirrors
 * apps/api). DB-unreachable is non-fatal — the integration tests' own
 * ensureDbReachable() gives a clearer signal than a globalSetup throw.
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
