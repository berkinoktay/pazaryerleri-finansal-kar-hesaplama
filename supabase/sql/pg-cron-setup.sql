-- pg_cron job definitions for marketplace sync
--
-- Applied AUTOMATICALLY by apply-policies.ts (cron step) on db:push (dev) and
-- db:deploy (prod) — the script creates the pg_cron + pg_net extensions first
-- and skips this file with a warning when the image doesn't ship them. CI sets
-- CI=true, which skips scheduling so cron ticks never race the test suite; the
-- fan-out SQL itself is exercised by packages/sync-core's pg-cron-fanout
-- integration test instead.
--
-- This file is environment-independent: the only env-specific values (the fx
-- Edge Function URL + service-role key) are read at RUN time from DB settings
-- (`app.supabase_functions_url`, `app.supabase_service_role_key`) that
-- apply-policies.ts sets from PG_CRON_FUNCTIONS_URL / SUPABASE_SECRET_KEY when
-- present. Unset → the fx job is a silent no-op; all queue fan-out jobs work
-- everywhere with no configuration.
--
-- cron.schedule upserts by job name, so re-applying is always safe.

-- ─── FX rates daily sync ──────────────────────────────────────────────────────
-- Fetches USD/EUR rates from TCMB (Türkiye Cumhuriyet Merkez Bankası) and
-- upserts them into fx_rates via the fx-rates-sync Edge Function.
--
-- Schedule: 16:00 Istanbul time on business days (Mon–Fri).
-- Istanbul is UTC+3, so 16:00 IST = 13:00 UTC.
-- Cron expression: '0 13 * * 1-5'
--
-- The WHERE guard makes the call a no-op until apply-policies.ts has set both
-- app.* settings for this database — so the job can be scheduled everywhere
-- without a key, and configured environments start firing on the next tick.
--
SELECT cron.schedule(
  'fx-rates-sync-daily',
  '0 13 * * 1-5',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_functions_url', true) || '/fx-rates-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key', true)
    ),
    body    := '{}'::jsonb
  )
  WHERE current_setting('app.supabase_functions_url', true) IS NOT NULL
    AND current_setting('app.supabase_service_role_key', true) IS NOT NULL;
  $$
);

-- ─── Orders delta sync (safety-net polling) ───────────────────────────────────
-- Webhook (real-time, T+0) is the PRIMARY order ingest path. This hourly cron
-- is the safety net: it enqueues a PENDING ORDERS sync_log for every ACTIVE
-- store so the worker re-scans and recovers anything a webhook missed
-- (delivery failure, worker downtime). It does NOT call Trendyol directly —
-- the polling sync-worker claims the PENDING row and runs the stream fetch.
--
-- Schedule: '0 * * * *' — top of every hour (PR-A 2026-05-24, spec §5.4).
--
-- Dedupe: a store with an in-flight ORDERS sync (PENDING/RUNNING/
-- FAILED_RETRYABLE) is skipped so ticks never stack on a slow/stuck sync.
--
-- Required columns on the raw INSERT: `id` and `started_at` have NO database
-- default (Prisma fills them app-side), so they are set explicitly here —
-- gen_random_uuid() + now(). sync_logs has no created_at/updated_at columns.
--
-- NOTE: each enqueued sync walks a per-tick delta window (PR #433). The worker
-- derives the cutoff from the completion time of the last COMPLETED ORDERS sync
-- via computeDeltaCutoffMs (widening automatically after an outage of any
-- length), clamped so it never precedes store.createdAt; the first sync for a
-- store still runs forward-only from that floor, and each hourly tick re-scans
-- its window idempotently.
--
SELECT cron.schedule(
  'sync-orders-delta',
  '0 * * * *',
  $$
  INSERT INTO sync_logs (id, organization_id, store_id, sync_type, status, started_at)
  SELECT gen_random_uuid(), s.organization_id, s.id, 'ORDERS', 'PENDING', now()
  FROM stores s
  WHERE s.status = 'ACTIVE'
    AND NOT EXISTS (
      SELECT 1 FROM sync_logs sl
      WHERE sl.store_id = s.id
        AND sl.sync_type = 'ORDERS'
        AND sl.status IN ('PENDING', 'RUNNING', 'FAILED_RETRYABLE')
    );
  $$
);

-- ─── Products daily refresh ───────────────────────────────────────────────────
-- Enqueues a PENDING PRODUCTS sync_log per ACTIVE store once a day. The
-- catalog has no webhook feed, so without this job new products / price
-- changes only ever arrived via manual sync (or the connect-time bootstrap).
-- A full catalog scan is the heaviest sync (~5 min for a 5.5k-product store),
-- so it runs once a day at the lowest-traffic hour.
--
-- Schedule: '0 0 * * *' — 00:00 UTC = 03:00 Istanbul (permanent GMT+3).
--
-- Dedupe: same NOT EXISTS in-flight guard as sync-orders-delta.
--
SELECT cron.schedule(
  'sync-products-daily',
  '0 0 * * *',
  $$
  INSERT INTO sync_logs (id, organization_id, store_id, sync_type, status, started_at)
  SELECT gen_random_uuid(), s.organization_id, s.id, 'PRODUCTS', 'PENDING', now()
  FROM stores s
  WHERE s.status = 'ACTIVE'
    AND NOT EXISTS (
      SELECT 1 FROM sync_logs sl
      WHERE sl.store_id = s.id
        AND sl.sync_type = 'PRODUCTS'
        AND sl.status IN ('PENDING', 'RUNNING', 'FAILED_RETRYABLE')
    );
  $$
);

-- ─── Settlements scan (6h cadence) ────────────────────────────────────────────
-- Enqueues a PENDING SETTLEMENTS sync_log per ACTIVE store every 6 hours.
-- The worker's settlements handler scans the full 60-day window each tick
-- (idempotent per-row anchors absorb the overlap — handlers/settlements/cron.ts).
-- Job definition added in PR-13: design §5.5 always specified this cadence,
-- but no cron job existed — settlements only ever ran via manual enqueue.
--
-- Dedupe: same NOT EXISTS in-flight guard as sync-orders-delta.
--
SELECT cron.schedule(
  'sync-settlements-6h',
  '30 */6 * * *',
  $$
  INSERT INTO sync_logs (id, organization_id, store_id, sync_type, status, started_at)
  SELECT gen_random_uuid(), s.organization_id, s.id, 'SETTLEMENTS', 'PENDING', now()
  FROM stores s
  WHERE s.status = 'ACTIVE'
    AND NOT EXISTS (
      SELECT 1 FROM sync_logs sl
      WHERE sl.store_id = s.id
        AND sl.sync_type = 'SETTLEMENTS'
        AND sl.status IN ('PENDING', 'RUNNING', 'FAILED_RETRYABLE')
    );
  $$
);

-- ─── Claims scan (6h cadence, PR-13) ──────────────────────────────────────────
-- Enqueues a PENDING CLAIMS sync_log per ACTIVE store every 6 hours. The
-- worker's claims handler re-reads the 60-day creation-date window each tick
-- (getClaims date filters do NOT move on status updates) and upserts
-- OrderClaim/OrderClaimItem idempotently — handlers/claims.ts.
--
-- Offset from the settlements tick (minute 45 vs 30) so a store's two
-- financial scans don't contend for the same worker slot at once.
--
SELECT cron.schedule(
  'sync-claims-6h',
  '45 */6 * * *',
  $$
  INSERT INTO sync_logs (id, organization_id, store_id, sync_type, status, started_at)
  SELECT gen_random_uuid(), s.organization_id, s.id, 'CLAIMS', 'PENDING', now()
  FROM stores s
  WHERE s.status = 'ACTIVE'
    AND NOT EXISTS (
      SELECT 1 FROM sync_logs sl
      WHERE sl.store_id = s.id
        AND sl.sync_type = 'CLAIMS'
        AND sl.status IN ('PENDING', 'RUNNING', 'FAILED_RETRYABLE')
    );
  $$
);

-- ─── Live Performance buffer daily safety-net (Slice 0) ───────────────────────
-- Calls reset_live_performance_buffer() (supabase/sql/db-functions.sql), which
-- deletes ONLY PERMANENT_FAILED entries whose order_date is older than 7 days:
-- un-graduatable corrupt rows the sync-worker could not write to `orders`. Every
-- PERMANENT_FAILED past-day row is retried on each flush tick
-- (processPastDayBufferFlush) for a final graduation attempt, and recoverable
-- entries (PENDING / PROMOTING / FAILED) are graduated by the worker, never by
-- this cron, so no buffer row is deleted without either landing in `orders` or
-- surviving the 7-day recovery window. db-functions.sql is the single source of
-- truth for the predicate, so the integration test exercises the exact same
-- logic (pg_cron cannot run in CI). The predicate is self-correcting: it removes
-- every PERMANENT_FAILED row older than 7 days whenever it fires, so the fire
-- time only changes how soon over-retained rows are purged, never which rows.
--
-- Schedule: '0 21 * * *' — 21:00 UTC = 00:00 business time. Türkiye is permanent
-- GMT+3 (no DST since 2016), so this lands at business midnight, matching the
-- fx-rates cron convention (hardcode the UTC equivalent of the local wall-clock
-- time; pg_cron 1.6.4 has no per-job timezone support — verified empirically).
--
-- Prerequisite: db-functions.sql must be applied first (it is — apply-policies
-- runs every AUTO_APPLIED file before this cron step).
--
SELECT cron.schedule(
  'live-performance-buffer-daily-reset',
  '0 21 * * *',
  $$ SELECT reset_live_performance_buffer(); $$
);
