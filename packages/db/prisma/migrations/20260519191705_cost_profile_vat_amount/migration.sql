-- PR-4: CostProfile KDV ayrıştırma (design §3.5 düzeltilmiş, §12.1 #10)
-- amount ZATEN NET — convention'i empirik doğrulandı (2026-05-19).
-- Bu migration sadece eksik vatAmount kolonlarını ekler + mevcut rows için
-- inline backfill yapar. amount dokunulmaz.

-- AlterTable
ALTER TABLE "cost_profile_versions" ADD COLUMN     "vat_amount" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "cost_profiles" ADD COLUMN     "vat_amount" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "order_item_cost_snapshot_components" ADD COLUMN     "vat_amount" DECIMAL(12,2),
ADD COLUMN     "vat_amount_in_try" DECIMAL(12,2);

-- ─── Backfill: mevcut satırlar için vatAmount türet ────────────────────
-- Convention: amount NET, vatRate yüzde (örn. 20 = %20).
-- vat_amount = ROUND(amount × vat_rate / 100, 2)
-- vat_amount_in_try = ROUND(amount_in_try × vat_rate / 100, 2)  (snapshot)
UPDATE "cost_profiles"
   SET "vat_amount" = ROUND("amount" * "vat_rate"::numeric / 100, 2)
 WHERE "vat_amount" IS NULL;

UPDATE "cost_profile_versions"
   SET "vat_amount" = ROUND("amount" * "vat_rate"::numeric / 100, 2)
 WHERE "vat_amount" IS NULL;

UPDATE "order_item_cost_snapshot_components"
   SET "vat_amount"        = ROUND("amount" * "vat_rate"::numeric / 100, 2),
       "vat_amount_in_try" = ROUND("amount_in_try" * "vat_rate"::numeric / 100, 2)
 WHERE "vat_amount" IS NULL;

-- ─── CHECK constraints: vat_amount nonneg ──────────────────────────────
-- Mirrored to supabase/sql/check-constraints.sql for db:push workflow.
ALTER TABLE "cost_profiles" ADD CONSTRAINT "cost_profiles_vat_amount_nonneg"
  CHECK ("vat_amount" IS NULL OR "vat_amount" >= 0);

ALTER TABLE "cost_profile_versions" ADD CONSTRAINT "cost_profile_versions_vat_amount_nonneg"
  CHECK ("vat_amount" IS NULL OR "vat_amount" >= 0);

ALTER TABLE "order_item_cost_snapshot_components"
  ADD CONSTRAINT "order_item_cost_snapshot_components_vat_amount_nonneg"
  CHECK ("vat_amount" IS NULL OR "vat_amount" >= 0);

ALTER TABLE "order_item_cost_snapshot_components"
  ADD CONSTRAINT "order_item_cost_snapshot_components_vat_amount_in_try_nonneg"
  CHECK ("vat_amount_in_try" IS NULL OR "vat_amount_in_try" >= 0);
