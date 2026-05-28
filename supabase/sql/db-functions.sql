-- PostgreSQL functions for business logic that runs at DB level
-- (e.g., trigger functions, RLS helper functions)

-- ─── Live Performance buffer daily reset ──────────────────────────────────────
-- Hard-deletes buffer entries whose business date is before today, so the
-- /live-performance surface starts each business day empty (Spec 2 §10). The
-- predicate is self-correcting: it deletes "everything before today" whenever it
-- runs, so the exact cron fire time only affects how soon stale rows are purged,
-- never which rows. Stale yesterday rows are invisible to the seller regardless
-- (the page filters the buffer to order_date = today), so this is pure
-- housekeeping: bound table growth + stop the promote worker (apps/sync-worker)
-- from churning yesterday's PENDING/FAILED entries.
--
-- System-wide (all orgs/stores) — a maintenance job, not a tenant-scoped query.
-- Returns the number of rows deleted (for the cron log + the integration test).
--
-- TIMEZONE: 'Europe/Istanbul' is the single SQL-level mirror of APP_TIME_ZONE
-- (@pazarsync/utils). Postgres cannot import the TS constant, and the design
-- accepts this as the one unavoidable literal — keep it here and nowhere else.
--
-- SECURITY DEFINER + pinned search_path: same shape as can_access_store — the
-- body runs as its owner (RLS-bypassed) so it is never blocked by
-- live_performance_buffer's row-level security.
CREATE OR REPLACE FUNCTION public.reset_live_performance_buffer()
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH deleted AS (
    DELETE FROM live_performance_buffer
    WHERE order_date < (now() AT TIME ZONE 'Europe/Istanbul')::date
    RETURNING 1
  )
  SELECT count(*) FROM deleted;
$$;
