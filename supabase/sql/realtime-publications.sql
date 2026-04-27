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
-- RLS policy: see rls-policies.sql — `sync_logs_org_member_read` walks
-- to the parent store row and checks `is_org_member(stores.organization_id)`.
-- Realtime respects RLS, so a user with no membership receives nothing.
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
