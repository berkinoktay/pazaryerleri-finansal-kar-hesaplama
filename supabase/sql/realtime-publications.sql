-- Tables published to the `supabase_realtime` publication. Subscribed
-- browser clients receive INSERT / UPDATE / DELETE events filtered by
-- their RLS policies (the same `is_org_member(organization_id)` checks
-- that gate REST reads).
--
-- Adding a table here is the LAST step of enabling Realtime for it —
-- the RLS policy MUST already exist and be tested, otherwise events
-- leak across tenants. Audit checklist before each addition:
--
--   1. The table has `ENABLE ROW LEVEL SECURITY`.
--   2. The table has a SELECT policy that scopes by org membership.
--   3. The org-isolation test in `apps/api/tests/integration/rls/`
--      verifies a cross-org user gets zero rows.
--
-- Idempotent: ALTER PUBLICATION ADD TABLE errors if the table is
-- already in the publication, so we DROP and re-add. The publication
-- itself is created by Supabase during `supabase start`.

-- ─── sync_logs ────────────────────────────────────────────────────────
-- Powers the SyncCenter UI (PR 5 of the products-page rollout). The UI
-- subscribes filtered by `store_id=eq.<id>` so only the user's active
-- store's syncs trigger client-side updates.
--
-- RLS policy: see rls-policies.sql — `sync_logs_org_member_read` gates on
-- `can_access_store(store_id)` (a SECURITY DEFINER STABLE plain-function call
-- the postgres_changes evaluator accepts). So a MEMBER/VIEWER receives sync
-- events only for the stores they were granted, and a non-member receives
-- nothing. (This is NOT a bare is_org_member check — the finer store-grant
-- model is the invariant to validate before adding any store-scoped table here.)
--
-- ALTER PUBLICATION ... ADD TABLE has no IF NOT EXISTS form, and
-- DROP TABLE has no IF EXISTS — wrap in a DO block that checks
-- pg_publication_tables first so the script stays idempotent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'sync_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sync_logs;
  END IF;
END $$;

-- ─── orders ───────────────────────────────────────────────────────────
-- Live-performance KPIs / chart / orders feed + the global new-order
-- notifier subscribe filtered by store_id=eq.<id>. The client only acts on
-- INSERT (a brand-new costed order, or a Slice-0 persisted late-arrival).
--
-- RLS policy: rls-policies.sql — orders_org_member_read USING
-- can_access_store(store_id), a SECURITY DEFINER STABLE plain-function call
-- the postgres_changes evaluator accepts. Do NOT rewrite it as inline
-- cross-table EXISTS (Realtime rejects that).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
  END IF;
END $$;

-- ─── live_performance_buffer ──────────────────────────────────────────
-- Cost-missing today's orders. Subscribed event '*': INSERT (new pending
-- order → toast) and UPDATE (cost attached, PENDING → PROMOTING).
-- RLS: live_performance_buffer_org_member_read USING can_access_store(store_id).
--
-- REPLICA IDENTITY DEFAULT (NOT full) — tenant-isolation fix. Postgres Changes
-- does NOT apply RLS to DELETE events (Supabase docs: "there is no way for
-- Postgres to verify a user has access to a deleted record") and cannot filter
-- them. We previously set REPLICA IDENTITY FULL so the client's store_id filter
-- could match on the promotion DELETE — but FULL writes the ENTIRE old row
-- (raw_payload + mapped_order: customer PII, full order financials) to the WAL
-- on every delete, so a DELETE event on this high-frequency table became a
-- cross-tenant exposure of another org's buffered orders. With DEFAULT the old
-- row carries only the PK, so nothing tenant-identifying leaves the tenant.
--
-- The promotion refresh does NOT depend on the buffer DELETE: on promotion the
-- worker writes the order to `orders` (an INSERT that IS published and IS
-- RLS-checked on the NEW row), and the live-performance client already
-- subscribes to that orders INSERT and refreshes on it (subscribeToLivePerformance
-- in apps/web/src/lib/supabase/realtime.ts — both the buffer and the orders
-- handlers call onEvent()). The only other buffer DELETE is the midnight cron
-- purging PERMANENT_FAILED corrupt rows, which the UI never needs to react to.
-- ALTER ... REPLICA IDENTITY DEFAULT is idempotent (safe to re-run).
ALTER TABLE public.live_performance_buffer REPLICA IDENTITY DEFAULT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'live_performance_buffer'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.live_performance_buffer;
  END IF;
END $$;
