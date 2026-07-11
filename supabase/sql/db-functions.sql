-- PostgreSQL functions for business logic that runs at DB level
-- (e.g., trigger functions, RLS helper functions)

-- ─── Live Performance buffer daily reset (Slice 0: narrowed safety-net) ───────
-- Hard-deletes ONLY PERMANENT_FAILED buffer entries whose order_date (business
-- date) is OLDER THAN 7 DAYS: rows the worker tried to graduate into `orders` and
-- could not (a corrupt mapped_order that makes upsertOrderWithSnapshot throw on
-- every retry). The sync-worker's past-day flush (processPastDayBufferFlush)
-- retries every such row on each tick, so a mapped_order that becomes graduatable
-- still lands in `orders`; this cron only reaps rows STILL PERMANENT_FAILED after
-- a 7-day recovery window, so deleting one never loses a recoverable sale.
-- Recoverable entries (PENDING / PROMOTING / FAILED)
-- are graduated by apps/sync-worker (processPastDayBufferFlush + the promote
-- tick) and must NEVER be deleted here — that is the "never lose an order"
-- guarantee. The worker already logs each row on the PERMANENT_FAILED transition
-- (markFailed → syncLog.error 'buffer.promote-permanent-failed' with lastError),
-- so this delete is never silent.
--
-- The predicate is self-correcting: it removes "every PERMANENT_FAILED row older
-- than 7 days" whenever it runs, so the exact cron fire time only affects how
-- soon over-retained rows are purged, never which rows.
--
-- STOCK: a reaped row had already decremented local variant stock at intake
-- (owner ruling 2026-07-11 — the sale is real the moment the order arrives, even
-- if it never gets booked into `orders`). That decrement is deliberately NOT
-- reversed here: the unit genuinely left the shelf, so leaving stock down is
-- correct. Only the split-dematerialize path (intake-order.ts) ever re-adds a
-- decrement, and only because the split children re-book the same units.
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
    -- Retention window: reap PERMANENT_FAILED rows only once their business date
    -- is older than 7 days. The sync-worker's flush retries them until then, so a
    -- row is deleted only after either landing in `orders` or surviving 7 days.
    WHERE order_date < ((now() AT TIME ZONE 'Europe/Istanbul')::date - 7)
      AND status = 'PERMANENT_FAILED'
    RETURNING 1
  )
  SELECT count(*) FROM deleted;
$$;

-- Client-RPC hardening: PostgREST exposes public functions as RPC
-- (POST /rest/v1/rpc/<name>). reset_live_performance_buffer() is SECURITY DEFINER
-- (runs a system-wide, cross-org DELETE as postgres, RLS-bypassed) and is
-- pg_cron-only — a browser JWT must never be able to trigger it. We revoke from
-- PUBLIC AND from anon/authenticated explicitly: the Supabase image ships an
-- ALTER DEFAULT PRIVILEGES that grants EXECUTE on new public functions DIRECTLY
-- to anon/authenticated (not only via PUBLIC), so `FROM PUBLIC` alone leaves the
-- direct grant intact. The pg_cron caller runs as the DB owner / service_role and
-- keeps access. CREATE OR REPLACE preserves grants on replace, so this also
-- re-hardens an already-deployed function on the next apply. Idempotent.
--
-- NOTE: is_org_member() / can_access_store() are deliberately NOT revoked here —
-- RLS policy evaluation for the `authenticated` role requires EXECUTE on them,
-- and they only ever answer a boolean about the caller's own auth.uid().
REVOKE EXECUTE ON FUNCTION public.reset_live_performance_buffer() FROM PUBLIC, anon, authenticated;
