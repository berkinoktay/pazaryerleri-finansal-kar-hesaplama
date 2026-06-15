-- DB-level invariants enforced via PostgreSQL CHECK constraints and
-- partial UNIQUE indexes. Applied by `pnpm db:apply-policies` after
-- `prisma db push`.
--
-- Prisma 7 does not have native syntax for CHECK constraints or partial
-- (WHERE-clause) unique indexes, so they live here separately from
-- schema.prisma. Production deployment via `prisma migrate deploy` picks
-- them up from the matching migration.sql (each constraint/index is
-- mirrored to its introducing migration file).
--
-- Idempotent: DROP CONSTRAINT IF EXISTS before ADD CONSTRAINT;
-- CREATE UNIQUE INDEX IF NOT EXISTS for partial uniques.

-- ─── order_items: refunded ≤ gross commission (GROSS convention 2026-06-16) ──
-- refunded_commission_gross > commission_gross olursa Trendyol mapping hatası
-- veya Discount Sale'den önce işlenmiş demektir. @default(0) → 0 ≤ 0 tutarlı.
-- Eski net-bazlı constraint'ler (refunded_commission_amount_net) silindi;
-- estimated pair constraint da kaldırıldı (tek estimated_commission_gross kaldı).
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_refunded_commission_check;
ALTER TABLE order_items ADD CONSTRAINT order_items_refunded_commission_check
  CHECK (refunded_commission_gross <= commission_gross);

ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_estimated_refunded_commission_check;

-- ─── GROSS konvansiyon: cost vat_rate nonneg (2026-06-16) ────────────────
-- GROSS convention'a geçildi: amount(net)+vatAmount → amountGross+vatRate.
-- vatRate oranı daima ≥ 0 (negatif KDV oranı imkânsız). Eski vat_amount_nonneg
-- constraint'leri GROSS refactor kapsamında kaldırıldı; vat_rate_nonneg aldı.

ALTER TABLE cost_profiles DROP CONSTRAINT IF EXISTS cost_profiles_vat_amount_nonneg;
ALTER TABLE cost_profiles DROP CONSTRAINT IF EXISTS cost_profiles_vat_rate_nonneg;
ALTER TABLE cost_profiles ADD CONSTRAINT cost_profiles_vat_rate_nonneg CHECK (vat_rate >= 0);

ALTER TABLE cost_profile_versions DROP CONSTRAINT IF EXISTS cost_profile_versions_vat_amount_nonneg;
ALTER TABLE cost_profile_versions DROP CONSTRAINT IF EXISTS cost_profile_versions_vat_rate_nonneg;
ALTER TABLE cost_profile_versions ADD CONSTRAINT cost_profile_versions_vat_rate_nonneg CHECK (vat_rate >= 0);

ALTER TABLE order_item_cost_snapshot_components DROP CONSTRAINT IF EXISTS order_item_cost_snapshot_components_vat_amount_nonneg;
ALTER TABLE order_item_cost_snapshot_components DROP CONSTRAINT IF EXISTS order_item_cost_snapshot_components_vat_amount_in_try_nonneg;
ALTER TABLE order_item_cost_snapshot_components DROP CONSTRAINT IF EXISTS order_item_cost_snapshot_components_vat_rate_nonneg;
ALTER TABLE order_item_cost_snapshot_components ADD CONSTRAINT order_item_cost_snapshot_components_vat_rate_nonneg CHECK (vat_rate >= 0);

-- ─── #297: settlement fee idempotency — partial unique guards ──────────
-- Çift fee yazımı DB seviyesinde imkânsız (kod disiplini değil). Kaynak-bazlı
-- kimlik kolonlarda yaşar; external_ref JSONB audit-only (okuma yolu yok).
-- Mirror: prisma/migrations/20260611120000_order_fee_idempotency_columns.
--
-- Return üçlüsü (REFUND_DEDUCTION / COMMISSION_REFUND / COST_RETURN) aynı
-- trendyol_transaction_id'yi paylaşır, bacaklar fee_type ile ayrışır →
-- fee_type anahtarın parçası. ESTIMATE kaynağı kimlik kolonu yazmaz →
-- IS NOT NULL predicate'i onu kapsam dışı bırakır.
CREATE UNIQUE INDEX IF NOT EXISTS order_fees_settlement_leg_uniq
  ON order_fees (order_id, fee_type, trendyol_transaction_id)
  WHERE source = 'SETTLEMENT' AND trendyol_transaction_id IS NOT NULL;

-- Kargo faturası satır kimliği: aynı fatura (serial) içinde aynı koli
-- (parcel) bir kez yazılır — haftalık 60g re-scan'ler aynı faturaları
-- tekrar tekrar görür (PR-8 tasarımı).
CREATE UNIQUE INDEX IF NOT EXISTS order_fees_cargo_invoice_line_uniq
  ON order_fees (order_id, invoice_serial_number, parcel_unique_id)
  WHERE source = 'CARGO_INVOICE'
    AND invoice_serial_number IS NOT NULL
    AND parcel_unique_id IS NOT NULL;

-- Client-derived düzeltmeler (fast-delivery PSF indirimi): Trendyol satırı
-- yok, sipariş başına TEK düzeltme — marker kolonu anahtarın kendisi.
CREATE UNIQUE INDEX IF NOT EXISTS order_fees_derived_correction_uniq
  ON order_fees (order_id, fee_type, derived_from)
  WHERE derived_from IS NOT NULL;

-- Org-düzeyi period fee'ler: Trendyol transaction id org+fee_type başına tek.
CREATE UNIQUE INDEX IF NOT EXISTS org_period_fees_settlement_row_uniq
  ON org_period_fees (organization_id, fee_type, trendyol_transaction_id)
  WHERE trendyol_transaction_id IS NOT NULL;

-- ─── variant-recovery PR-2: ESTIMATE fee idempotency ───────────────────
-- T+0 PSF/Stopaj sipariş başına TEK'tir; geç maliyet re-entry'si (Slice C
-- manuel giriş, variant-resolution tick) veya yarışan iki tx çift yazamasın.
-- #297 guard'ları ESTIMATE'i bilinçli dışarıda bırakmıştı (kimlik kolonu
-- yok) — anahtar (order_id, fee_type). Derived düzeltme source='SETTLEMENT'
-- olduğundan kapsam dışı. Mirror: prisma/migrations/20260612020000.
-- Index'ten önce idempotent dedup: paylaşılan re-entry defekti çift yazmış
-- olabilir; en eski satır kalır, etkilenen siparişlerin yanlış kilitlenmiş
-- estimated_net_profit'i NULL'a çekilir (re-entry doğru değeri yazar).
WITH doomed AS (
  SELECT id, order_id
  FROM (
    SELECT id, order_id,
           row_number() OVER (
             PARTITION BY order_id, fee_type
             ORDER BY captured_at, id
           ) AS rn
    FROM order_fees
    WHERE source = 'ESTIMATE'
  ) ranked
  WHERE rn > 1
),
reset_orders AS (
  UPDATE orders SET estimated_net_profit = NULL
  WHERE id IN (SELECT DISTINCT order_id FROM doomed)
)
DELETE FROM order_fees WHERE id IN (SELECT id FROM doomed);

CREATE UNIQUE INDEX IF NOT EXISTS order_fees_estimate_fee_type_uniq
  ON order_fees (order_id, fee_type)
  WHERE source = 'ESTIMATE';

-- ─── variant-recovery PR-2: resolution kuyruğu partial index ───────────
-- Kuyruk sorgusu: product_variant_id IS NULL AND barcode IS NOT NULL AND
-- (next_resolution_at IS NULL OR <= now). Düz full-table index bu şekle
-- hizmet edemez; partial index çözülmemiş küçük kümeyi taşır. Şemadaki eski
-- düz sürümün kalıntısına karşı önce DROP (idempotent geçiş).
-- Mirror: prisma/migrations/20260612020000.
DROP INDEX IF EXISTS order_items_resolution_due_idx;
CREATE INDEX order_items_resolution_due_idx
  ON order_items (next_resolution_at)
  WHERE product_variant_id IS NULL AND barcode IS NOT NULL;

-- ─── 2026-06-12 profit-freeze: calculated-or-excluded ──────────────────
-- Orders'a giren her sipariş iki nihai durumdan birindedir: HESAPLANMIŞ
-- (estimated_net_profit NOT NULL) ya da KÂR-DIŞI (profit_excluded_at NOT
-- NULL). Üçüncü durum ("maliyeti sonra girilecek") yok — spec §3.
-- Mirror: prisma/migrations/20260612120000_order_profit_freeze.

-- Bir sipariş aynı anda hem hesaplanmış hem kâr-dışı olamaz.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_profit_freeze_xor_check;
ALTER TABLE orders ADD CONSTRAINT orders_profit_freeze_xor_check
  CHECK (NOT (estimated_net_profit IS NOT NULL AND profit_excluded_at IS NOT NULL));

-- Çift kolon tutarlılığı: damga ve gerekçe birlikte yaşar.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_profit_exclusion_pair_check;
ALTER TABLE orders ADD CONSTRAINT orders_profit_exclusion_pair_check
  CHECK ((profit_excluded_at IS NULL) = (profit_exclusion_reason IS NULL));

-- ─── 2026-06-13 desi sıfır-taban ───────────────────────────────────────
-- synced_dimensional_weight NON-NULL default 0; hiçbir desi 0'ın altına
-- inemez (negatif desi imkânsız). override (dimensional_weight) nullable
-- kalır. Mirror: prisma/migrations/20260613120000_dimensional_weight_zero_floor.
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_dimensional_weight_nonneg_check;
ALTER TABLE product_variants ADD CONSTRAINT product_variants_dimensional_weight_nonneg_check
  CHECK (synced_dimensional_weight >= 0 AND (dimensional_weight IS NULL OR dimensional_weight >= 0));
