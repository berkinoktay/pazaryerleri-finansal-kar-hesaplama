-- pg_cron job definitions for marketplace sync
-- Requires: pg_cron and pg_net extensions enabled in Supabase Dashboard

-- ─── FX rates daily sync ──────────────────────────────────────────────────────
-- Fetches USD/EUR rates from TCMB (Türkiye Cumhuriyet Merkez Bankası) and
-- upserts them into fx_rates.
--
-- Schedule: 16:00 Istanbul time on business days (Mon–Fri).
-- Istanbul is UTC+3, so 16:00 IST = 13:00 UTC.
-- Cron expression: '0 13 * * 1-5'
--
-- The Edge Function URL and service-role key are environment-specific.
-- Replace <SUPABASE_PROJECT_REF> with your project reference (e.g. "abcdefghijklmn")
-- and set <SUPABASE_SERVICE_ROLE_KEY> via a Postgres secret or vault lookup.
-- DO NOT commit a real service-role key here — use the vault pattern below.
--
-- To apply: psql "$DATABASE_URL" -f supabase/sql/pg-cron-setup.sql
--
SELECT cron.schedule(
  'fx-rates-sync-daily',
  '0 13 * * 1-5',
  $$
  SELECT net.http_post(
    url     := 'https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/fx-rates-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key', true)
    ),
    body    := '{}'::jsonb
  );
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
-- NOTE: each enqueued sync currently runs forward-only from the cutoff
-- (computeOrdersCutoffMs — store.createdAt by default). The intended per-tick
-- delta window (start from now − SYNC_SAFETY_NET_HOURS) is a follow-up handler
-- optimization; until then an hourly tick re-scans [cutoff, now] idempotently.
--
-- To apply: psql "$DATABASE_URL" -f supabase/sql/pg-cron-setup.sql
-- (cron.schedule upserts by job name, so re-applying is safe.)
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

-- ─── Settlements scan (6h cadence) ────────────────────────────────────────────
-- Enqueues a PENDING SETTLEMENTS sync_log per ACTIVE store every 6 hours.
-- The worker's settlements handler scans the full 60-day window each tick
-- (idempotent per-row anchors absorb the overlap — handlers/settlements/cron.ts).
-- Job definition added in PR-13: design §5.5 always specified this cadence,
-- but no cron job existed — settlements only ever ran via manual enqueue.
-- NOTE: defining the job here does NOT schedule it anywhere by itself —
-- per-environment apply is MANUAL (see issue #249 / file header).
--
-- Dedupe: same NOT EXISTS in-flight guard as sync-orders-delta.
--
-- To apply: psql "$DATABASE_URL" -f supabase/sql/pg-cron-setup.sql
-- (cron.schedule upserts by job name, so re-applying is safe.)
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
-- NOTE: per-environment apply is MANUAL (see issue #249 / file header).
--
-- To apply: psql "$DATABASE_URL" -f supabase/sql/pg-cron-setup.sql
-- (cron.schedule upserts by job name, so re-applying is safe.)
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
-- now deletes ONLY past-day PERMANENT_FAILED entries — un-graduatable corrupt
-- rows that the sync-worker could not write to `orders`. Recoverable entries are
-- graduated by the worker (processPastDayBufferFlush), never by this cron, so a
-- real sale is never deleted. db-functions.sql is the single source of truth for
-- the predicate, so the integration test exercises the exact same logic (pg_cron
-- cannot run in CI). The predicate is self-correcting: it removes every past-day
-- PERMANENT_FAILED row whenever it fires, so the fire time only changes how soon
-- stale rows are purged, never which rows.
--
-- Schedule: '0 21 * * *' — 21:00 UTC = 00:00 business time. Türkiye is permanent
-- GMT+3 (no DST since 2016), so this lands at business midnight, matching the
-- fx-rates cron convention (hardcode the UTC equivalent of the local wall-clock
-- time; pg_cron 1.6.4 has no per-job timezone support — verified empirically).
--
-- Prerequisite: db-functions.sql must be applied first (it is — apply-policies
-- runs it ahead of this manual file, and prod applies functions before crons).
--
-- To apply: psql "$DATABASE_URL" -f supabase/sql/pg-cron-setup.sql
-- (cron.schedule upserts by job name, so re-applying is safe.)
--
SELECT cron.schedule(
  'live-performance-buffer-daily-reset',
  '0 21 * * *',
  $$ SELECT reset_live_performance_buffer(); $$
);
