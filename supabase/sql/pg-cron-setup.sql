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
