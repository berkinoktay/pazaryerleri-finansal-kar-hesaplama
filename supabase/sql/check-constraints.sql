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

-- ─── order_items: refunded ≤ gross commission ──────────────────────────
-- Effective commission = gross − refunded (research §3.2, design §3.2 +
-- §10.1 unit testler). Refunded > gross olursa Trendyol mapping hatası
-- veya Discount Sale'den önce işlenmiş demektir → fırlat ve Sentry'ye
-- alert. Schema'da @default(0) olduğu için boş satırlar tutarlı (0 ≤ 0).
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_refunded_commission_check;
ALTER TABLE order_items ADD CONSTRAINT order_items_refunded_commission_check
  CHECK (refunded_commission_amount_net <= gross_commission_amount_net);

-- ─── PR-4: cost vat_amount nonneg (design §3.5 + §12.1 #10) ────────────
-- vat_amount = amount × vatRate / 100 (NET convention). Yasal vatRate 0..%30
-- aralığında — vat_amount negatif olamaz. NULL kabul: yeni satırlar sync
-- worker doldurana kadar boş kalabilir.

ALTER TABLE cost_profiles DROP CONSTRAINT IF EXISTS cost_profiles_vat_amount_nonneg;
ALTER TABLE cost_profiles ADD CONSTRAINT cost_profiles_vat_amount_nonneg
  CHECK (vat_amount IS NULL OR vat_amount >= 0);

ALTER TABLE cost_profile_versions DROP CONSTRAINT IF EXISTS cost_profile_versions_vat_amount_nonneg;
ALTER TABLE cost_profile_versions ADD CONSTRAINT cost_profile_versions_vat_amount_nonneg
  CHECK (vat_amount IS NULL OR vat_amount >= 0);

ALTER TABLE order_item_cost_snapshot_components DROP CONSTRAINT IF EXISTS order_item_cost_snapshot_components_vat_amount_nonneg;
ALTER TABLE order_item_cost_snapshot_components ADD CONSTRAINT order_item_cost_snapshot_components_vat_amount_nonneg
  CHECK (vat_amount IS NULL OR vat_amount >= 0);

ALTER TABLE order_item_cost_snapshot_components DROP CONSTRAINT IF EXISTS order_item_cost_snapshot_components_vat_amount_in_try_nonneg;
ALTER TABLE order_item_cost_snapshot_components ADD CONSTRAINT order_item_cost_snapshot_components_vat_amount_in_try_nonneg
  CHECK (vat_amount_in_try IS NULL OR vat_amount_in_try >= 0);

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
