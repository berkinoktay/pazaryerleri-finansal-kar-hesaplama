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

-- ─── Grant baseline (issue #305) ───────────────────────────────────────
-- GRANT and RLS are SEPARATE Postgres layers: the grant is the table-level
-- gate, the policy is the row-level filter. Until 2026-06-11 the Supabase
-- image's default public-schema privileges silently provided the grants our
-- policies sit on; Supabase CLI v2.106.0 changed that default and every
-- RLS-scoped read started failing with 42501 (CI red on main while local
-- CLIs were still pre-2.106). The repo now states its own baseline so the
-- security surface never depends on an image default again.
--
-- `authenticated` gets table DML — actual row access is still default-deny
-- under RLS until a policy explicitly allows it (write policies don't exist
-- yet, so writes stay blocked even with the grant). `service_role` carries
-- BYPASSRLS in Supabase images but still needs plain grants. `anon` is
-- deliberately absent: no pre-login surface reads the database.
-- Idempotent; ON ALL TABLES re-runs on every apply, and DEFAULT PRIVILEGES
-- covers tables created between two applies.
GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;

-- ─── Non-tenant public tables: revoke the blanket grant ───────────────────────
-- The GRANT above hands `authenticated` DML on EVERY public table, and RLS
-- default-deny only protects a table where RLS was actually ENABLE-d. Any public
-- table that is neither a tenant table (with an RLS policy below) nor a global
-- reference table (RLS + USING(true)) is therefore fully cross-tenant readable
-- AND writable via PostgREST. `_prisma_migrations` is the live instance: Prisma
-- owns it (created by `prisma migrate deploy` in prod; the postgres/service_role
-- keeps access), it holds no tenant data, and it must never be enrolled in RLS —
-- so it is REVOKE-d instead. Without this, any authenticated JWT could read or
-- corrupt migration history via `/rest/v1/_prisma_migrations`, breaking every
-- future deploy platform-wide (empirically reproducible; covered by the
-- "no public base table is readable by authenticated without RLS" RLS test).
-- Guarded by an existence check because db:push dev DBs may not have the table.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
     WHERE relname = '_prisma_migrations'
       AND relnamespace = 'public'::regnamespace
       AND relkind = 'r'
  ) THEN
    REVOKE ALL ON public._prisma_migrations FROM authenticated, anon;
  END IF;
END
$$;

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

-- ─── can_access_store helper ───────────────────────────────────────────
-- Store-scoped tables gate on store ACCESS, not bare org membership.
-- OWNER/ADMIN of the store's org see every store in it; MEMBER/VIEWER see
-- only stores they hold a member_store_access grant for. Panel access for a
-- MEMBER/VIEWER therefore requires >= 1 grant.
--
-- Same SECURITY DEFINER STABLE shape as is_org_member: the body runs as its
-- owner (postgres, RLS-bypassed), so the internal joins on stores /
-- organization_members / member_store_access do NOT re-trigger RLS — no 42P17
-- recursion. Being a plain function call (not an inline cross-table EXISTS),
-- it is also accepted by Supabase Realtime's postgres_changes evaluator on
-- sync_logs, exactly like is_org_member.
CREATE OR REPLACE FUNCTION public.can_access_store(_store_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM stores s
    JOIN organization_members m
      ON m.organization_id = s.organization_id
     AND m.user_id = auth.uid()
    WHERE s.id = _store_id
      AND (
        m.role IN ('OWNER', 'ADMIN')
        OR EXISTS (
          SELECT 1 FROM member_store_access g
          WHERE g.store_id = s.id
            AND g.member_id = m.id
        )
      )
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

-- ─── store-scoped tables — gated by can_access_store ──────────────────
-- Store-level operational data. Visibility follows store access (OWNER/ADMIN:
-- every store in the org; MEMBER/VIEWER: granted stores only), not bare org
-- membership. `stores` keys on its own id; child tables on store_id, or walk
-- up to the parent's store_id when they have none.
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stores_org_member_read ON stores;
CREATE POLICY stores_org_member_read ON stores
  FOR SELECT TO authenticated
  USING (can_access_store(id));

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS products_org_member_read ON products;
CREATE POLICY products_org_member_read ON products
  FOR SELECT TO authenticated
  USING (can_access_store(store_id));

-- product_variants denormalizes organization_id onto itself
-- (rather than reaching via Product) so the policy can
-- be a flat is_org_member() check — same 42P17 avoidance pattern as
-- products. The data path that writes it (ProductSyncService) holds
-- both ids and stamps organization_id at insert time, so denormalization
-- has no maintenance cost.
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_variants_org_member_read ON product_variants;
CREATE POLICY product_variants_org_member_read ON product_variants
  FOR SELECT TO authenticated
  USING (can_access_store(store_id));

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orders_org_member_read ON orders;
CREATE POLICY orders_org_member_read ON orders
  FOR SELECT TO authenticated
  USING (can_access_store(store_id));

-- expenses.store_id is nullable: org-level expenses (NULL) follow org
-- membership; store-attributed expenses follow store access, so a MEMBER
-- granted only store A never sees store B's costs.
--
-- The store-attributed branch ANDs is_org_member(organization_id) ON TOP of
-- can_access_store(store_id). Reason: store_id is only a plain FK (references
-- stores.id, not a composite (id, organization_id)), so an expense row could
-- carry organization_id = A while store_id points at a store in org B. Without
-- the org check, a member of org B would then read org A's expense amount via
-- can_access_store(B). Requiring is_org_member(organization_id) too means the
-- reader must belong to the row's OWN org, closing that cross-org read.
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expenses_org_member_read ON expenses;
CREATE POLICY expenses_org_member_read ON expenses
  FOR SELECT TO authenticated
  USING (
    is_org_member(organization_id)
    AND (store_id IS NULL OR can_access_store(store_id))
  );

-- ─── order_items — reach via parent order ──────────────────────────────
-- order_items has no store_id column; walk up to its order and gate on that
-- order's store access.
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_items_org_member_read ON order_items;
CREATE POLICY order_items_org_member_read ON order_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_items.order_id
        AND can_access_store(orders.store_id)
    )
  );

-- ─── sync_logs — store-scoped, Realtime-exposed ───────────────────────
-- sync_logs carries store_id directly, so the policy gates on
-- can_access_store(store_id). Supabase Realtime's postgres_changes evaluator
-- can't handle an inline cross-table EXISTS, but can_access_store — like
-- is_org_member before it — is a plain SECURITY DEFINER function call, so
-- subscriptions keep working. A MEMBER only receives sync events for the
-- stores they were granted.
ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sync_logs_org_member_read ON sync_logs;
CREATE POLICY sync_logs_org_member_read ON sync_logs
  FOR SELECT TO authenticated
  USING (can_access_store(store_id));

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

-- ─── own_shipping_tariffs — store-scoped, org-private ──────────────────
-- A seller's negotiated carrier rates for a specific store. Commercial cost
-- intelligence — gated on store access via store_id, same as stores / orders.
ALTER TABLE own_shipping_tariffs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_shipping_tariffs_org_member_read ON own_shipping_tariffs;
CREATE POLICY own_shipping_tariffs_org_member_read ON own_shipping_tariffs
  FOR SELECT TO authenticated
  USING (can_access_store(store_id));

-- ─── commission_tariffs — store-scoped saved campaign tariffs ──────────
-- The seller's uploaded Trendyol commission-tariff Excels (price-band promo
-- tariffs) + their per-product band selections. Store-private competitive
-- pricing intelligence — all three tables carry store_id and gate on
-- can_access_store. Writes are API-only (service role bypasses RLS).
ALTER TABLE commission_tariffs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commission_tariffs_store_read ON commission_tariffs;
CREATE POLICY commission_tariffs_store_read ON commission_tariffs
  FOR SELECT TO authenticated
  USING (can_access_store(store_id));

ALTER TABLE commission_tariff_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commission_tariff_periods_store_read ON commission_tariff_periods;
CREATE POLICY commission_tariff_periods_store_read ON commission_tariff_periods
  FOR SELECT TO authenticated
  USING (can_access_store(store_id));

ALTER TABLE commission_tariff_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commission_tariff_items_store_read ON commission_tariff_items;
CREATE POLICY commission_tariff_items_store_read ON commission_tariff_items
  FOR SELECT TO authenticated
  USING (can_access_store(store_id));

-- ─── plus_commission_tariffs — store-scoped saved Plus tariffs ─────────
-- Sibling of commission_tariffs: the seller's uploaded Trendyol "Plus Komisyon"
-- Excels + their per-product opt-ins. Same store-private isolation — both tables
-- carry store_id and gate on can_access_store. Writes are API-only.
ALTER TABLE plus_commission_tariffs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plus_commission_tariffs_store_read ON plus_commission_tariffs;
CREATE POLICY plus_commission_tariffs_store_read ON plus_commission_tariffs
  FOR SELECT TO authenticated
  USING (can_access_store(store_id));

ALTER TABLE plus_commission_tariff_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plus_commission_tariff_periods_store_read ON plus_commission_tariff_periods;
CREATE POLICY plus_commission_tariff_periods_store_read ON plus_commission_tariff_periods
  FOR SELECT TO authenticated
  USING (can_access_store(store_id));

ALTER TABLE plus_commission_tariff_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plus_commission_tariff_items_store_read ON plus_commission_tariff_items;
CREATE POLICY plus_commission_tariff_items_store_read ON plus_commission_tariff_items
  FOR SELECT TO authenticated
  USING (can_access_store(store_id));

-- ─── advantage_tariffs — store-scoped saved Advantage Label tariffs ────
-- Sibling of plus_commission_tariffs: the seller's uploaded Trendyol "Avantajlı
-- Ürün Etiketleri" Excels + their per-product tier selections. Store-private;
-- both tables carry store_id and gate on can_access_store. Writes are API-only.
-- (Commission is read cross-vertically from commission_tariffs, which has its own
-- store-scoped policy — no extra policy needed here.)
ALTER TABLE advantage_tariffs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS advantage_tariffs_store_read ON advantage_tariffs;
CREATE POLICY advantage_tariffs_store_read ON advantage_tariffs
  FOR SELECT TO authenticated
  USING (can_access_store(store_id));

ALTER TABLE advantage_tariff_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS advantage_tariff_items_store_read ON advantage_tariff_items;
CREATE POLICY advantage_tariff_items_store_read ON advantage_tariff_items
  FOR SELECT TO authenticated
  USING (can_access_store(store_id));

-- ─── flash_product_lists — store-scoped saved Flash Products lists ─────
-- Sibling of advantage_tariffs: the seller's uploaded Trendyol "Flaş Ürünler"
-- Excels + their per-product offer selections. Store-private; both tables carry
-- store_id and gate on can_access_store. Writes are API-only. (Commission is
-- read cross-vertically from commission_tariffs, which has its own store-scoped
-- policy — no extra policy needed here.)
ALTER TABLE flash_product_lists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS flash_product_lists_store_read ON flash_product_lists;
CREATE POLICY flash_product_lists_store_read ON flash_product_lists
  FOR SELECT TO authenticated
  USING (can_access_store(store_id));

ALTER TABLE flash_product_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS flash_product_items_store_read ON flash_product_items;
CREATE POLICY flash_product_items_store_read ON flash_product_items
  FOR SELECT TO authenticated
  USING (can_access_store(store_id));

-- ─── discount_lists — store-scoped saved Discounts (Promosyon > İndirimler) ─────
-- Sibling of flash_product_lists: the seller's uploaded Trendyol "İndirimler"
-- Excels + the per-list discount configuration + per-product participation picks.
-- Store-private; both tables carry store_id and gate on can_access_store. Writes
-- are API-only. Commission is read cross-vertically from commission_tariffs and
-- product_variants, each covered by its own policy — no extra policy needed here.
ALTER TABLE discount_lists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS discount_lists_store_read ON discount_lists;
CREATE POLICY discount_lists_store_read ON discount_lists
  FOR SELECT TO authenticated
  USING (can_access_store(store_id));

ALTER TABLE discount_list_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS discount_list_items_store_read ON discount_list_items;
CREATE POLICY discount_list_items_store_read ON discount_list_items
  FOR SELECT TO authenticated
  USING (can_access_store(store_id));

-- ─── marketplace_campaign_lists — Trendyol kampanyalarına katılım ───────────
-- discount_lists'in kardeşi: satıcının yüklediği Trendyol kampanya Excel'leri +
-- kampanya kurgusu + karşılama oranı + ürün başına fiyat seçimleri. Mağazaya özel;
-- iki tablo da store_id taşır ve can_access_store ile kapılanır. Yazma yalnız API
-- üzerinden. Komisyon dikeyler arası okunur (commission_tariffs, product_variants)
-- ve her biri kendi politikasıyla korunur — burada ek politika gerekmez.
ALTER TABLE marketplace_campaign_lists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketplace_campaign_lists_store_read ON marketplace_campaign_lists;
CREATE POLICY marketplace_campaign_lists_store_read ON marketplace_campaign_lists
  FOR SELECT TO authenticated
  USING (can_access_store(store_id));

ALTER TABLE marketplace_campaign_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketplace_campaign_items_store_read ON marketplace_campaign_items;
CREATE POLICY marketplace_campaign_items_store_read ON marketplace_campaign_items
  FOR SELECT TO authenticated
  USING (can_access_store(store_id));

-- ─── order_claims — store-scoped ───────────────────────────────────────
-- İade talep görünürlüğü; getclaims sync worker (PR-13) yazar. store_id
-- denormalize (#298) — parent-walk yerine doğrudan can_access_store(store_id),
-- sync_logs pattern'i. Sync worker store_id'yi her insert'te parent order'dan
-- stamp'ler.
ALTER TABLE order_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_claims_org_member_read ON order_claims;
CREATE POLICY order_claims_org_member_read ON order_claims
  FOR SELECT TO authenticated
  USING (can_access_store(store_id));

-- ─── order_claim_items — reach via parent claim ────────────────────────
-- No store_id; walk to the parent claim and gate on ITS denormalized
-- store_id (#298 — the orders join dropped). Recursion-safe:
-- can_access_store is a SECURITY DEFINER helper, same as is_org_member.
ALTER TABLE order_claim_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_claim_items_org_member_read ON order_claim_items;
CREATE POLICY order_claim_items_org_member_read ON order_claim_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM order_claims
      WHERE order_claims.id = order_claim_items.claim_id
        AND can_access_store(order_claims.store_id)
    )
  );

-- ─── fee_definitions — global reference, public read ──────────────────
-- Pazaryeri × ücret tipi başına sistem-düzeyi tanım. Tüm seller'lara aynı
-- kural — shipping_carriers / marketplace_commission_rate ile
-- aynı pattern. Yazma postgres rolü (PR-2 seed migration); authenticated
-- INSERT/UPDATE/DELETE policy yok → default-deny.
ALTER TABLE fee_definitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fee_definitions_authenticated_read ON fee_definitions;
CREATE POLICY fee_definitions_authenticated_read ON fee_definitions
  FOR SELECT TO authenticated
  USING (true);

-- ─── micro_export_return_fee_tiers — global reference, public read ─────
-- Mikro ihracat "Yurt Dışı İade Operasyon Bedeli" kademe oranları (≤2000₺→%35,
-- >2000₺→%30). Tüm seller'lara aynı — fee_definitions / shipping_barem_tariffs ile
-- aynı pattern. Yazma postgres rolü (seed migration); authenticated INSERT/UPDATE/DELETE
-- policy yok → default-deny. Backend (Prisma) zaten superuser ile okur (RLS bypass);
-- bu policy defense-in-depth + scoped-client okumalarına izin.
ALTER TABLE micro_export_return_fee_tiers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS micro_export_return_fee_tiers_authenticated_read ON micro_export_return_fee_tiers;
CREATE POLICY micro_export_return_fee_tiers_authenticated_read ON micro_export_return_fee_tiers
  FOR SELECT TO authenticated
  USING (true);

-- ─── webhook_events — store-scoped read (PR-C1) ───────────────────────────
-- Trendyol webhook idempotency log + raw audit trail. Composite unique key
-- (storeId, platformOrderId, platformStatus, platformLastModifiedDate) →
-- re-delivery'de INSERT P2002 → handler 200 OK döner. SELECT yalnız o mağazaya
-- erişimi olan member'lara — debugging/admin için. INSERT/UPDATE/DELETE
-- yalnız service role (webhook handler postgres role kullanır); authenticated
-- mutation policy YOK → default-deny.
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webhook_events_org_member_read ON webhook_events;
CREATE POLICY webhook_events_org_member_read ON webhook_events
  FOR SELECT TO authenticated
  USING (can_access_store(store_id));

-- ─── member_store_access — co-member read; writes API-only ─────────────
-- The grant rows themselves. Any org member may read their org's grants —
-- the management UI is capability-gated (members:read / manage_access) at the
-- route layer, and grants are not competitive intel, so a flat is_org_member()
-- read is sufficient defense-in-depth. Writes go through the backend with the
-- postgres role (RLS-bypassed); there is no authenticated INSERT/UPDATE/DELETE
-- policy, so direct client writes default-deny.
ALTER TABLE member_store_access ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS member_store_access_org_member_read ON member_store_access;
CREATE POLICY member_store_access_org_member_read ON member_store_access
  FOR SELECT TO authenticated
  USING (is_org_member(organization_id));

-- ─── live_performance_buffer — store-scoped read (Spec 2 PR-A) ─────────────
-- Cost-eksik bugünkü siparişlerin grace-period buffer'ı. store_id taşır →
-- store access ile gate'lenir (orders / sync_logs / webhook_events ile aynı
-- pattern, #218). OWNER/ADMIN org'daki tüm mağazaları görür; MEMBER/VIEWER
-- yalnız grant'li mağazaları → erişimi olmayan üye o mağazanın bugünkü
-- siparişlerini görmez. INSERT/UPDATE/DELETE yalnız service role (webhook
-- receiver, promote worker, cost-attach service postgres role kullanır,
-- RLS bypass); authenticated mutation policy YOK → default-deny.
ALTER TABLE live_performance_buffer ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS live_performance_buffer_org_member_read ON live_performance_buffer;
CREATE POLICY live_performance_buffer_org_member_read ON live_performance_buffer
  FOR SELECT TO authenticated
  USING (can_access_store(store_id));

-- ─── catalog_barcode_miss — store-scoped read (catalog-gap tracking) ────────
-- Onaylı katalog-boşluğu barkodları (sipariş geldi, barkod katalogda yok). store_id
-- taşır → store access ile gate'lenir (orders / sync_logs / live_performance_buffer
-- ile aynı pattern, #218). OWNER/ADMIN org'daki tüm mağazaları görür; MEMBER/VIEWER
-- yalnız grant'li mağazaları → erişimi olmayan üye o mağazanın eksik barkodlarını
-- görmez. INSERT/UPDATE/DELETE yalnız service role (sync-worker + catalog-sync
-- postgres role kullanır, RLS bypass); authenticated mutation policy YOK →
-- default-deny. Gate düz can_access_store(store_id) (SECURITY DEFINER helper) —
-- inline EXISTS subquery DEĞİL (42P17 recursion + Realtime evaluator kırılması).
ALTER TABLE catalog_barcode_miss ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS catalog_barcode_miss_org_member_read ON catalog_barcode_miss;
CREATE POLICY catalog_barcode_miss_org_member_read ON catalog_barcode_miss
  FOR SELECT TO authenticated
  USING (can_access_store(store_id));

-- ─── price_change_logs — store-scoped read (trendyol-price-write) ────────
-- Trendyol'a yazılan fiyat değişikliklerinin denetim kaydı. store_id taşır →
-- store access ile gate'lenir (orders / sync_logs / catalog_barcode_miss ile
-- aynı pattern). OWNER/ADMIN org'daki tüm mağazaları görür; MEMBER/VIEWER
-- yalnız grant'li mağazaları → erişimi olmayan üye o mağazanın fiyat log'larını
-- görmez. INSERT/UPDATE/DELETE yalnız service role (backend postgres bağlantısı
-- RLS'i bypass eder); authenticated mutation policy YOK → default-deny.
-- Gate düz can_access_store(store_id) — SECURITY DEFINER helper, 42P17 güvenli.
ALTER TABLE price_change_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS price_change_logs_org_member_read ON price_change_logs;
CREATE POLICY price_change_logs_org_member_read ON price_change_logs
  FOR SELECT TO authenticated
  USING (can_access_store(store_id));

-- --- profit persistence tables (rebuild, phase 3A) ------------------------
-- profit_lines, profit_line_allocations, order_profit_statements and
-- marketplace_finance_records all carry a store_id stamped by the profit writer
-- from the parent order (or the store). Reads are gated by can_access_store(store_id)
-- (SECURITY DEFINER helper, 42P17 safe); OWNER/ADMIN see every store in their org,
-- MEMBER/VIEWER only granted stores. Writes are service-role only (the profit
-- writer and sync handlers use the postgres connection, which bypasses RLS);
-- there is no authenticated INSERT/UPDATE/DELETE policy, so direct client writes
-- default-deny.
ALTER TABLE profit_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profit_lines_org_member_read ON profit_lines;
CREATE POLICY profit_lines_org_member_read ON profit_lines
  FOR SELECT TO authenticated
  USING (can_access_store(store_id));

ALTER TABLE profit_line_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profit_line_allocations_org_member_read ON profit_line_allocations;
CREATE POLICY profit_line_allocations_org_member_read ON profit_line_allocations
  FOR SELECT TO authenticated
  USING (can_access_store(store_id));

ALTER TABLE order_profit_statements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_profit_statements_org_member_read ON order_profit_statements;
CREATE POLICY order_profit_statements_org_member_read ON order_profit_statements
  FOR SELECT TO authenticated
  USING (can_access_store(store_id));

ALTER TABLE marketplace_finance_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketplace_finance_records_org_member_read ON marketplace_finance_records;
CREATE POLICY marketplace_finance_records_org_member_read ON marketplace_finance_records
  FOR SELECT TO authenticated
  USING (can_access_store(store_id));

-- --- profit recompute queue (rebuild, phase 3B) ---------------------------
-- profit_recompute_queue carries a store_id stamped by each producer from the
-- parent order. Reads are gated by can_access_store(store_id) (SECURITY DEFINER
-- helper, 42P17 safe); OWNER/ADMIN see every store in their org, MEMBER/VIEWER
-- only granted stores. Writes are service-role only (the producers and the
-- sync-worker drain use the postgres connection, which bypasses RLS); there is
-- no authenticated INSERT/UPDATE/DELETE policy, so direct client writes
-- default-deny.
ALTER TABLE profit_recompute_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profit_recompute_queue_org_member_read ON profit_recompute_queue;
CREATE POLICY profit_recompute_queue_org_member_read ON profit_recompute_queue
  FOR SELECT TO authenticated
  USING (can_access_store(store_id));

-- --- Campaign parent tables: hide the raw uploaded workbook (source_file) ---
-- commission_tariffs, plus_commission_tariffs, advantage_tariffs,
-- flash_product_lists, discount_lists and marketplace_campaign_lists keep the
-- seller's uploaded .xlsx bytes in `source_file` so export can byte-patch the
-- marketplace's exact file. Those bytes are competitive pricing intelligence and
-- the API hands them out only to DATA_WRITE callers, yet the row policies above
-- (can_access_store) let every member who can see the store, VIEWER included,
-- read the whole row through PostgREST. The column is therefore withheld at the
-- privilege layer; the row policies stay exactly as they are.
--
-- Why a column-level `REVOKE SELECT (source_file)` alone does nothing: Postgres
-- grants access when EITHER the table-level OR the column-level privilege is
-- present, and the grant baseline at the top of this file re-grants table-level
-- SELECT on every public table to `authenticated` on every apply. So this block
-- drops the table-level SELECT (a table-level REVOKE also clears every
-- column-level SELECT grant on that table) and then grants SELECT back column by
-- column, on every column except source_file.
--
-- The column list is regenerated from information_schema on every
-- `pnpm db:apply-policies`, so a new column needs no edit here. A column added by
-- a migration between two applies starts with no grant for `authenticated`, i.e.
-- closed until the next apply (the safe direction); `db:deploy` chains the apply
-- right after `migrate deploy`. If `source_file` is ever renamed or moved, the
-- first guard below fails the apply instead of silently granting the renamed
-- column. The last guard checks the EFFECTIVE privilege afterwards, so a grant
-- this block cannot see (another grantor, PUBLIC) fails the apply loudly rather
-- than leaving the bytes readable.
--
-- `anon` loses table-level SELECT and gets nothing back (no policy targets it).
-- INSERT/UPDATE/DELETE grants are unchanged; service_role and the postgres role
-- keep full access. A scoped-client `.select('*')` on these tables now fails
-- with 42501, so scoped reads must name their columns.
--
-- Must stay BELOW the grant baseline. apply-policies sends this file as a single
-- query, which Postgres runs as one implicit transaction, so the baseline's
-- re-grant is never visible to another session.
DO $$
DECLARE
  _table text;
  _columns text;
BEGIN
  FOREACH _table IN ARRAY ARRAY[
    'commission_tariffs',
    'plus_commission_tariffs',
    'advantage_tariffs',
    'flash_product_lists',
    'discount_lists',
    'marketplace_campaign_lists'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = _table
         AND column_name = 'source_file'
    ) THEN
      RAISE EXCEPTION 'public.%.source_file not found; update the source_file privilege block in rls-policies.sql', _table;
    END IF;

    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
      INTO _columns
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = _table
       AND column_name <> 'source_file';

    EXECUTE format('REVOKE SELECT ON public.%I FROM authenticated, anon', _table);
    EXECUTE format('GRANT SELECT (%s) ON public.%I TO authenticated', _columns, _table);

    IF has_column_privilege('authenticated', format('public.%I', _table), 'source_file', 'SELECT')
       OR has_column_privilege('anon', format('public.%I', _table), 'source_file', 'SELECT') THEN
      RAISE EXCEPTION 'public.%.source_file is still readable by the scoped client after the privilege reset', _table;
    END IF;
  END LOOP;
END
$$;
