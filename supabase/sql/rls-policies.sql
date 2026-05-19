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

-- ─── sync_logs active-slot uniqueness ────────────────────────
-- Atomically guarantees one active sync per (store_id, sync_type).
-- Concurrent enqueue requests → one INSERT wins, the other gets
-- 23505 unique-violation, mapped to SyncInProgressError(409). The
-- "active" predicate covers PENDING / RUNNING / FAILED_RETRYABLE
-- states; terminal states (COMPLETED, FAILED) are not constrained.
CREATE UNIQUE INDEX IF NOT EXISTS sync_logs_active_slot_uniq
  ON sync_logs (store_id, sync_type)
  WHERE status IN ('PENDING', 'RUNNING', 'FAILED_RETRYABLE');

-- ─── cost_profiles — org-scoped read ─────────────────────────────────
-- Writes are API-only via the postgres role. The Hono backend handles
-- create/update/archive through the cost-profile service, which checks
-- organization scope before every mutation. RLS here just guards
-- authenticated-client SELECTs for the Costs page.
ALTER TABLE cost_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cost_profiles_org_member_read ON cost_profiles;
CREATE POLICY cost_profiles_org_member_read ON cost_profiles
  FOR SELECT TO authenticated
  USING (is_org_member(organization_id));

-- ─── cost_profile_versions — org-scoped read ─────────────────────────
-- Append-only audit log. Writes happen in the same Prisma transaction
-- as profile updates (cost-profile.service.ts). RLS denies any direct
-- write from authenticated clients.
ALTER TABLE cost_profile_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cost_profile_versions_org_member_read ON cost_profile_versions;
CREATE POLICY cost_profile_versions_org_member_read ON cost_profile_versions
  FOR SELECT TO authenticated
  USING (is_org_member(organization_id));

-- ─── product_variant_cost_profiles — org-scoped read ─────────────────
-- The cross-org INSERT guard (variant.organization_id MUST match
-- profile.organization_id MUST match request context's org) is
-- enforced at the backend service layer (cost-profile-attachment.service.ts),
-- not in RLS. The backend reads both rows via the postgres role,
-- compares organization_id, and rejects with COST_PROFILE_VARIANT_ORG_MISMATCH
-- (HTTP 422) before any INSERT. RLS here only governs authenticated reads.
ALTER TABLE product_variant_cost_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_variant_cost_profiles_org_member_read ON product_variant_cost_profiles;
CREATE POLICY product_variant_cost_profiles_org_member_read ON product_variant_cost_profiles
  FOR SELECT TO authenticated
  USING (is_org_member(organization_id));

-- ─── order_item_cost_snapshot_components — org-scoped read ───────────
-- Frozen, write-once. Inserts happen only via the sync worker (Edge
-- Function with service-role key) when an order arrives and its variant
-- has cost profiles attached. Updates are blocked by the
-- reject_snapshot_update trigger in cost-snapshot-immutable.sql (Task 1.4).
-- RLS just gates authenticated reads.
ALTER TABLE order_item_cost_snapshot_components ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_item_cost_snapshot_components_org_member_read ON order_item_cost_snapshot_components;
CREATE POLICY order_item_cost_snapshot_components_org_member_read ON order_item_cost_snapshot_components
  FOR SELECT TO authenticated
  USING (is_org_member(organization_id));

-- ─── fx_rates — global read, service-role writes ─────────────────────
-- FX rates are not tenant-scoped; the same TCMB rate applies to every
-- org. Any authenticated user can read the latest cached rates for UI
-- display (e.g., the cost-profile-fx-preview component). Writes are
-- service-role only via the fx-rates-sync Edge Function — postgres
-- bypasses RLS, and there is no INSERT/UPDATE/DELETE policy for
-- `authenticated`, so direct client writes default-deny.
ALTER TABLE fx_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fx_rates_authenticated_read ON fx_rates;
CREATE POLICY fx_rates_authenticated_read ON fx_rates
  FOR SELECT TO authenticated
  USING (true);

-- marketplace_commission_rate: platform-scoped reference data, NOT tenant-private.
-- Trendyol/Hepsiburada commission tariff is the same for every seller on the
-- platform — segment-based overrides conceptually exist, but the marketplaces
-- don't expose a seller's segment via API, so profit calculation always uses
-- base_rate. Storing per-tenant would mean duplicating the same ~35K rows for
-- every org, which is wasteful and inconsistent. One global table, every
-- authenticated user reads the same rows.
--
-- Writes are API-only — the Hono backend uses the service role connection
-- (DATABASE_URL) which bypasses RLS, so no INSERT/UPDATE/DELETE policy for
-- authenticated is needed and direct client writes default-deny.
ALTER TABLE marketplace_commission_rate ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketplace_commission_rate_org_member_read ON marketplace_commission_rate;
DROP POLICY IF EXISTS marketplace_commission_rate_authenticated_read ON marketplace_commission_rate;
CREATE POLICY marketplace_commission_rate_authenticated_read ON marketplace_commission_rate
  FOR SELECT TO authenticated
  USING (true);

-- ─── shipping_carriers — global reference, public read for authenticated ───
-- Carriers list (Yurtiçi, Aras, MNG, …) is platform-scoped reference data,
-- not tenant-private. Every authenticated user sees the same rows. Writes
-- are API-only via the postgres role; no INSERT/UPDATE/DELETE policy for
-- authenticated means direct client writes default-deny.
ALTER TABLE shipping_carriers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shipping_carriers_authenticated_read ON shipping_carriers;
CREATE POLICY shipping_carriers_authenticated_read ON shipping_carriers
  FOR SELECT TO authenticated
  USING (true);

-- ─── shipping_desi_tariffs — global ────────────────────────────────────
-- Marketplace-published desi → price tariff. Same reasoning as
-- shipping_carriers: global reference data, every authenticated user
-- reads identical rows; writes are API-only.
ALTER TABLE shipping_desi_tariffs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shipping_desi_tariffs_authenticated_read ON shipping_desi_tariffs;
CREATE POLICY shipping_desi_tariffs_authenticated_read ON shipping_desi_tariffs
  FOR SELECT TO authenticated
  USING (true);

-- ─── shipping_barem_tariffs — global ───────────────────────────────────
-- Marketplace-published barem (order-amount band) tariff. Same shape as
-- shipping_desi_tariffs above.
ALTER TABLE shipping_barem_tariffs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shipping_barem_tariffs_authenticated_read ON shipping_barem_tariffs;
CREATE POLICY shipping_barem_tariffs_authenticated_read ON shipping_barem_tariffs
  FOR SELECT TO authenticated
  USING (true);

-- ─── own_shipping_tariffs — org-private ────────────────────────────────
-- A seller's negotiated carrier rates for one of their stores. These
-- reveal commercial cost intelligence and MUST be tenant-isolated; same
-- flat is_org_member() pattern as stores / products / orders.
ALTER TABLE own_shipping_tariffs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_shipping_tariffs_org_member_read ON own_shipping_tariffs;
CREATE POLICY own_shipping_tariffs_org_member_read ON own_shipping_tariffs
  FOR SELECT TO authenticated
  USING (is_org_member(organization_id));

-- ─── Profit Calculation V1 — PR-1 ──────────────────────────────────────
-- design: docs/plans/2026-05-18-profit-calculation-design.md §3, §8
-- guide:  docs/plans/2026-05-19-profit-calc-implementation-guide.md

-- ─── order_fees — org-scoped, denormalized organization_id ────────────
-- Sipariş paket-düzeyi ücret satırları (PSF, Stopaj, Shipping, vs.). Sync
-- worker insert sırasında organizationId'yi stamp eder; flat is_org_member()
-- pattern (products / variants / sync_logs ile aynı, EXISTS recursion riski yok).
ALTER TABLE order_fees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_fees_org_member_read ON order_fees;
CREATE POLICY order_fees_org_member_read ON order_fees
  FOR SELECT TO authenticated
  USING (is_org_member(organization_id));

-- ─── order_claims — org-scoped, denormalized organization_id ─────────
-- İade talep görünürlüğü; getclaims sync worker (PR-13) yazar. Tenant boundary
-- denormalize edilmiş — sayı az olduğu için EXISTS walk overhead'i gereksiz.
ALTER TABLE order_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_claims_org_member_read ON order_claims;
CREATE POLICY order_claims_org_member_read ON order_claims
  FOR SELECT TO authenticated
  USING (is_org_member(organization_id));

-- ─── order_claim_items — reach via parent claim ────────────────────────
-- order_items pattern: no direct organization_id, walk to parent claim.
-- Recursion risk yok çünkü order_claims kendi policy'sini is_org_member ile
-- evaluate eder (SECURITY DEFINER helper'a sarılı).
ALTER TABLE order_claim_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_claim_items_org_member_read ON order_claim_items;
CREATE POLICY order_claim_items_org_member_read ON order_claim_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM order_claims
      WHERE order_claims.id = order_claim_items.claim_id
        AND is_org_member(order_claims.organization_id)
    )
  );

-- ─── org_period_fees — org-scoped ─────────────────────────────────────
-- Org-düzeyi ücretler (Reklam, Penalty, Notification, PSF/Stopaj audit).
-- Kar hesabını etkilemez; yalnız audit/transparency. Settlement worker (PR-7) yazar.
ALTER TABLE org_period_fees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_period_fees_org_member_read ON org_period_fees;
CREATE POLICY org_period_fees_org_member_read ON org_period_fees
  FOR SELECT TO authenticated
  USING (is_org_member(organization_id));

-- ─── commission_invoices — org-scoped ──────────────────────────────────
-- Trendyol haftalık komisyon faturası aggregate. otherfinancials 'Komisyon
-- Faturası' kayıtlarından oluşturulur (PR-7). OrderItem.commissionInvoiceId
-- FK PR-3'te eklenir; o zaman backfill akışı tamamlanır.
ALTER TABLE commission_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commission_invoices_org_member_read ON commission_invoices;
CREATE POLICY commission_invoices_org_member_read ON commission_invoices
  FOR SELECT TO authenticated
  USING (is_org_member(organization_id));

-- ─── fee_definitions — global reference, public read ──────────────────
-- Pazaryeri × ücret tipi başına sistem-düzeyi tanım. Tüm seller'lara aynı
-- kural — fx_rates / shipping_carriers / marketplace_commission_rate ile
-- aynı pattern. Yazma postgres rolü (PR-2 seed migration); authenticated
-- INSERT/UPDATE/DELETE policy yok → default-deny.
ALTER TABLE fee_definitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fee_definitions_authenticated_read ON fee_definitions;
CREATE POLICY fee_definitions_authenticated_read ON fee_definitions
  FOR SELECT TO authenticated
  USING (true);
