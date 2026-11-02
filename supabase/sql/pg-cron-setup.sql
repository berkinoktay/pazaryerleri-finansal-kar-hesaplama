-- pg_cron job definitions for marketplace sync
--
-- Applied AUTOMATICALLY by apply-policies.ts (cron step) on db:push (dev) and
-- db:deploy (prod) — the script creates the pg_cron extension first and skips
-- this file with a warning when the image doesn't ship it. CI sets CI=true,
-- which skips scheduling so cron ticks never race the test suite; the fan-out
-- SQL itself is exercised by packages/sync-core's pg-cron-fanout integration
-- test instead.
--
-- This file is environment-independent: every job runs entirely inside Postgres
-- (queue fan-out INSERTs + a buffer reset), so no job needs any configuration.
--
-- cron.schedule upserts by job name, so re-applying is always safe.

-- --- FX rates daily sync (removed) -------------------------------------------
-- The product is lira-only: the fx-rates-sync job and its Edge Function are gone.
-- cron.schedule upserts by name, so deleting the block alone would leave the job
-- running in existing databases, so unschedule it idempotently here.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'fx-rates-sync-daily';

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
-- Thundering-herd stagger: every ACTIVE store used to be enqueued with
-- started_at = now(), so at 00:00 the worker pool saw the entire fleet's
-- heaviest sync (a full ~5-min catalog scan each) become claimable in the
-- same instant. tryClaimNext now treats started_at as an EARLIEST-RUN time
-- (it claims WHERE started_at <= now() ORDER BY COALESCE(next_attempt_at,
-- started_at)), so spreading each store's started_at deterministically over a
-- 30-minute window makes the claim scan release them gradually instead of all
-- at once — no extra scheduler machinery. The offset is stable per store
-- (hash of the store id) so re-runs land in the same slot. In the meantime the
-- hourly PRODUCTS_DELTA sweep keeps stock/price fresh, and the hourly
-- PRODUCTS_CHANGES walk picks up new products and status/metadata changes.
SELECT cron.schedule(
  'sync-products-daily',
  '0 0 * * *',
  $$
  INSERT INTO sync_logs (id, organization_id, store_id, sync_type, status, started_at)
  -- hashtext() returns int4 (full range, INT_MIN included); abs(INT_MIN) would
  -- overflow int4 and abort the whole fan-out INSERT, so cast to bigint before
  -- abs. Same 0..1799s distribution for every other store id.
  SELECT gen_random_uuid(), s.organization_id, s.id, 'PRODUCTS', 'PENDING',
         now() + make_interval(secs => (abs(hashtext(s.id::text)::bigint) % 1800)::int)
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

-- ─── Products delta sync (hourly stock+price refresh) ─────────────────────────
-- Enqueues a PENDING PRODUCTS_DELTA sync_log per ACTIVE store every hour. The
-- worker's products-delta handler walks Trendyol's approved inventory-and-price
-- feed (stock + price only), diffs each page against the DB in memory, and
-- writes back only the variants whose quantity or sale/list price drifted.
--
-- This endpoint has NO date filter, so every tick is a lightweight FULL walk of
-- the approved catalog — but the in-memory diff keeps writes minimal. It is not
-- a replacement for the daily full PRODUCTS scan: that scan remains the
-- metadata reconciliation (titles, images, brand/category) and the delist
-- diff (absence-from-feed), which the delta handler deliberately never touches.
--
-- Schedule: '15 * * * *' — quarter past every hour, offset from the orders
-- safety-net tick (minute :00) so the two hourly fan-outs don't enqueue at once.
--
-- Dedupe: same NOT EXISTS in-flight guard as sync-orders-delta, scoped to the
-- PRODUCTS_DELTA type. NOTE: the sync_logs active-slot uniqueness is per
-- (store, sync_type), so a PRODUCTS_DELTA run and a full PRODUCTS run can be
-- in flight for the same store at once. That is benign — both write authoritative
-- vendor stock/price values, so whichever lands last simply reasserts the truth.
--
SELECT cron.schedule(
  'sync-products-delta-hourly',
  '15 * * * *',
  $$
  INSERT INTO sync_logs (id, organization_id, store_id, sync_type, status, started_at)
  SELECT gen_random_uuid(), s.organization_id, s.id, 'PRODUCTS_DELTA', 'PENDING', now()
  FROM stores s
  WHERE s.status = 'ACTIVE'
    AND NOT EXISTS (
      SELECT 1 FROM sync_logs sl
      WHERE sl.store_id = s.id
        AND sl.sync_type = 'PRODUCTS_DELTA'
        AND sl.status IN ('PENDING', 'RUNNING', 'FAILED_RETRYABLE')
    );
  $$
);

-- --- Products changes sync (hourly date-window walk) -------------------------
-- Enqueues a PENDING PRODUCTS_CHANGES sync_log per ACTIVE store every hour. The
-- worker's products-changes handler walks Trendyol's approved product list with
-- a date filter, one page per chunk, in three phases: VARIANT_MODIFIED_DATE,
-- CONTENT_MODIFIED_DATE, then VARIANT_CREATED_DATE over a wider lookback (for
-- products Trendyol approves late). It upserts only the products returned, so
-- new products and status/metadata changes (lock, archive, title, images) land
-- within the hour instead of waiting for the daily full scan. Stock and price
-- stay with PRODUCTS_DELTA.
--
-- Window: anchored on started_at of the store's last COMPLETED PRODUCTS_CHANGES
-- run (else of its last COMPLETED PRODUCTS full scan) minus a 15-minute safety
-- margin, capped at 48 hours back, and ending at this run's started_at (now()
-- below). A FAILED run never moves the window, because the anchor reads
-- COMPLETED runs only; the next tick rescans the same range.
--
-- Never delists: absence from a date-filtered page proves nothing, so the delist
-- diff stays with the daily full PRODUCTS scan.
--
-- Gate: a store is enqueued only once its first full PRODUCTS scan has
-- COMPLETED (the EXISTS clause). Before that there is no catalog and no anchor,
-- and an empty COMPLETED run during the bootstrap scan would become the next
-- tick's anchor and could hide changes made while that scan ran. The handler
-- still finishes empty when it finds no anchor, as a fallback only. The gate
-- filters on organization_id too: with all four equality columns it is one
-- probe of the (organization_id, status, store_id, sync_type, completed_at)
-- index, instead of walking a store's growing sync_logs history through the
-- (store_id, started_at) index when its early full scans FAILED.
--
-- Schedule: '45 * * * *' - minute :45 of every hour, offset from the orders
-- safety net (:00) and PRODUCTS_DELTA (:15). It shares :45 with sync-claims-6h
-- on 4 of the 24 daily ticks; that is harmless, because the active slot is per
-- (store, sync_type) and a quiet hour costs only one request per phase.
--
-- Dedupe: same NOT EXISTS in-flight guard as sync-orders-delta, scoped to the
-- PRODUCTS_CHANGES type. A PRODUCTS_CHANGES run can be in flight alongside a
-- full PRODUCTS run for the same store; that is benign: both are idempotent
-- upserts of vendor truth, and PRODUCTS_CHANGES stamps last_synced_at only on
-- variants Trendyol just returned, so the full scan's delist pass never takes a
-- listed variant for a removed one.
--
SELECT cron.schedule(
  'sync-products-changes-hourly',
  '45 * * * *',
  $$
  INSERT INTO sync_logs (id, organization_id, store_id, sync_type, status, started_at)
  SELECT gen_random_uuid(), s.organization_id, s.id, 'PRODUCTS_CHANGES', 'PENDING', now()
  FROM stores s
  WHERE s.status = 'ACTIVE'
    AND NOT EXISTS (
      SELECT 1 FROM sync_logs sl
      WHERE sl.store_id = s.id
        AND sl.sync_type = 'PRODUCTS_CHANGES'
        AND sl.status IN ('PENDING', 'RUNNING', 'FAILED_RETRYABLE')
    )
    AND EXISTS (
      SELECT 1 FROM sync_logs fs
      WHERE fs.organization_id = s.organization_id
        AND fs.store_id = s.id
        AND fs.sync_type = 'PRODUCTS'
        AND fs.status = 'COMPLETED'
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
-- It shares minute :45 with sync-products-changes-hourly (see that job).
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
-- Schedule: '0 21 * * *' -- 21:00 UTC = 00:00 business time. Turkiye is permanent
-- GMT+3 (no DST since 2016), so this lands at business midnight. The convention
-- across every job here: hardcode the UTC equivalent of the local wall-clock
-- time, because pg_cron 1.6.4 has no per-job timezone support (verified empirically).
--
-- Prerequisite: db-functions.sql must be applied first (it is — apply-policies
-- runs every AUTO_APPLIED file before this cron step).
--
SELECT cron.schedule(
  'live-performance-buffer-daily-reset',
  '0 21 * * *',
  $$ SELECT reset_live_performance_buffer(); $$
);
