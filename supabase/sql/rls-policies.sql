-- Row-Level Security policies for multi-tenant isolation.
-- Applied after Prisma's `db push` via `pnpm db:apply-policies`.
--
-- Design principles:
--   - Policies target the `authenticated` role. The `postgres` superuser
--     (which our Prisma DATABASE_URL uses today) bypasses RLS entirely,
--     so backend service-role queries continue to work unchanged.
--   - Only SELECT policies are defined in Phase A. INSERT/UPDATE/DELETE
--     have no policy, which means default-deny for non-superuser roles.
--     CRUD endpoints add their own policies when they land.
--   - All policies use `auth.uid()` (Supabase's helper reading the JWT
--     sub claim) via the `is_org_member` helper defined below.
--   - Idempotent: DROP POLICY IF EXISTS before each CREATE POLICY so
--     `pnpm db:apply-policies` can run repeatedly without conflict.

-- ─── is_org_member helper ──────────────────────────────────────────────
-- A naive policy like
--   USING (EXISTS (SELECT 1 FROM organization_members WHERE …))
-- triggers "infinite recursion detected in policy" when the referenced
-- table also has RLS (because the sub-SELECT re-invokes RLS, which
-- re-invokes the same sub-SELECT, ad infinitum). SECURITY DEFINER runs
-- the function as its owner (postgres) which bypasses RLS inside the
-- function body, breaking the cycle. STABLE lets the planner cache the
-- result for a single query.
CREATE OR REPLACE FUNCTION public.is_org_member(_org_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = _org_id
      AND user_id = auth.uid()
  );
$$;

-- ─── user_profiles ─────────────────────────────────────────────────────
-- SELECT is self-only. INSERT is usually handled by the on_auth_user_created
-- trigger (see supabase/sql/triggers.sql), but we allow a self-INSERT path
-- for defensive `ensureExists()` upserts when the trigger missed (legacy
-- users pre-trigger, or cold-restore scenarios). UPDATE lets the account
-- settings screen change own timezone/language/fullName/avatar.
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_profiles_self_read ON user_profiles;
CREATE POLICY user_profiles_self_read ON user_profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS user_profiles_self_insert ON user_profiles;
CREATE POLICY user_profiles_self_insert ON user_profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS user_profiles_self_update ON user_profiles;
CREATE POLICY user_profiles_self_update ON user_profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ─── organizations ─────────────────────────────────────────────────────
-- Writes are API-only. The Hono backend uses Prisma with the postgres
-- role (DATABASE_URL), which bypasses RLS; all POST/PATCH/DELETE land
-- there. Authenticated clients (supabase-js from the browser) have no
-- INSERT/UPDATE/DELETE policy, so those operations default-deny. This
-- keeps first-membership atomicity and future billing/VKN write paths
-- on the server. See apps/api/src/routes/organization.routes.ts.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organizations_member_read ON organizations;
CREATE POLICY organizations_member_read ON organizations
  FOR SELECT TO authenticated
  USING (is_org_member(id));

-- ─── organization_members ──────────────────────────────────────────────
-- A user reads any membership row for an org they are a member of.
-- Writes are API-only for the same reason as organizations above:
-- the POST /v1/organizations handler inserts org + OWNER membership
-- in a single Prisma transaction. First-member insertion cannot go
-- through authenticated-client RLS because the user isn't a member
-- until the transaction commits (chicken-and-egg).
--
-- last_accessed_at: read+write authorized via existing is_org_member(organization_id)
-- policy. No new policy needed; column inherits row-level access.
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_members_co_member_read ON organization_members;
CREATE POLICY organization_members_co_member_read ON organization_members
  FOR SELECT TO authenticated
  USING (is_org_member(organization_id));

-- ─── stores / products / orders / expenses — same org-member pattern ───
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stores_org_member_read ON stores;
CREATE POLICY stores_org_member_read ON stores
  FOR SELECT TO authenticated
  USING (is_org_member(organization_id));

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS products_org_member_read ON products;
CREATE POLICY products_org_member_read ON products
  FOR SELECT TO authenticated
  USING (is_org_member(organization_id));

-- product_variants and product_images both denormalize organization_id
-- onto themselves (rather than reaching via Product) so the policy can
-- be a flat is_org_member() check — same 42P17 avoidance pattern as
-- products. The data path that writes them (ProductSyncService) holds
-- both ids and stamps organization_id at insert time, so denormalization
-- has no maintenance cost.
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_variants_org_member_read ON product_variants;
CREATE POLICY product_variants_org_member_read ON product_variants
  FOR SELECT TO authenticated
  USING (is_org_member(organization_id));

ALTER TABLE product_images ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_images_org_member_read ON product_images;
CREATE POLICY product_images_org_member_read ON product_images
  FOR SELECT TO authenticated
  USING (is_org_member(organization_id));

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orders_org_member_read ON orders;
CREATE POLICY orders_org_member_read ON orders
  FOR SELECT TO authenticated
  USING (is_org_member(organization_id));

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expenses_org_member_read ON expenses;
CREATE POLICY expenses_org_member_read ON expenses
  FOR SELECT TO authenticated
  USING (is_org_member(organization_id));

-- ─── order_items — reach via parent order ──────────────────────────────
-- order_items has no organization_id column; walk up to orders to find
-- the tenant context, then apply is_org_member.
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_items_org_member_read ON order_items;
CREATE POLICY order_items_org_member_read ON order_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_items.order_id
        AND is_org_member(orders.organization_id)
    )
  );

-- ─── settlements ───────────────────────────────────────────────────────
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS settlements_org_member_read ON settlements;
CREATE POLICY settlements_org_member_read ON settlements
  FOR SELECT TO authenticated
  USING (is_org_member(organization_id));

-- ─── settlement_items — reach via parent settlement ────────────────────
ALTER TABLE settlement_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS settlement_items_org_member_read ON settlement_items;
CREATE POLICY settlement_items_org_member_read ON settlement_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM settlements
      WHERE settlements.id = settlement_items.settlement_id
        AND is_org_member(settlements.organization_id)
    )
  );

-- ─── sync_logs — direct check via denormalized organization_id ────────
-- Originally walked to stores via EXISTS; that worked for REST reads
-- (Prisma bypasses RLS as superuser) but Supabase Realtime's
-- postgres_changes evaluator can't reliably handle cross-table EXISTS,
-- so subscriptions crashed with "Unable to subscribe to changes with
-- given parameters". We denormalize organization_id onto sync_logs
-- (kept in sync by syncLogService at insert time) so the policy is a
-- flat is_org_member() check — same pattern as products / variants /
-- images.
ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sync_logs_org_member_read ON sync_logs;
CREATE POLICY sync_logs_org_member_read ON sync_logs
  FOR SELECT TO authenticated
  USING (is_org_member(organization_id));
