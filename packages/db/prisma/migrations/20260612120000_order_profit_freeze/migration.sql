-- Profit-freeze columns (hand-written; shadow replay broken — PR-8 precedent;
-- SQL generated via `prisma migrate diff`).
-- Spec: docs/plans/2026-06-12-cost-deadline-profit-freeze-design.md §5.

-- CreateEnum
CREATE TYPE "ProfitExclusionReason" AS ENUM ('COST_DEADLINE_MISSED', 'LATE_UNCOSTED_ARRIVAL', 'LEGACY_BACKFILL');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "profit_excluded_at" TIMESTAMP(3),
ADD COLUMN     "profit_exclusion_reason" "ProfitExclusionReason";

-- Backfill: spec öncesi "null kârla mezun edilmiş / geç gelmiş" satırlar yeni
-- sözleşmede KÂR-DIŞI'dır (üçüncü durum yok). CANCELLED hariç (audit satırları
-- kâr evreninden status filtresiyle zaten dışarıda, her iki kolonu null kalır).
UPDATE orders SET profit_excluded_at = now(), profit_exclusion_reason = 'LEGACY_BACKFILL'
WHERE estimated_net_profit IS NULL AND status <> 'CANCELLED' AND profit_excluded_at IS NULL;

-- Bir sipariş aynı anda hem hesaplanmış hem kâr-dışı olamaz.
-- Mirror: supabase/sql/check-constraints.sql.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_profit_freeze_xor_check;
ALTER TABLE orders ADD CONSTRAINT orders_profit_freeze_xor_check
  CHECK (NOT (estimated_net_profit IS NOT NULL AND profit_excluded_at IS NOT NULL));

-- Çift kolon tutarlılığı: damga ve gerekçe birlikte yaşar.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_profit_exclusion_pair_check;
ALTER TABLE orders ADD CONSTRAINT orders_profit_exclusion_pair_check
  CHECK ((profit_excluded_at IS NULL) = (profit_exclusion_reason IS NULL));
