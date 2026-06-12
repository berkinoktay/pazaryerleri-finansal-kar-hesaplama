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

-- ─── reject_profit_freeze_breach (mirror: supabase/sql/triggers.sql) ────
-- Calculated-or-excluded sözleşmesinin (spec 2026-06-12 §3) DB bekçisi.
-- Kâr-dışı (profit_excluded_at NOT NULL) sipariş: estimate/settled kâr
-- yazımı, damganın silinmesi/değişmesi yasak. Hesaplanmış sipariş kâr-dışına
-- çekilemez. Status/kargo gibi diğer kolonlar serbest. Not SECURITY DEFINER:
-- görevi reddetmek, yetki aşmak değil (reject_snapshot_update ile aynı).
CREATE OR REPLACE FUNCTION public.reject_profit_freeze_breach()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.profit_excluded_at IS NOT NULL THEN
    IF NEW.estimated_net_profit IS DISTINCT FROM OLD.estimated_net_profit THEN
      RAISE EXCEPTION 'profit-excluded order: estimated_net_profit is frozen'
        USING ERRCODE = '42501',
              HINT = 'Cost window closed at end of order day; exclusion is permanent.';
    END IF;
    IF NEW.settled_net_profit IS DISTINCT FROM OLD.settled_net_profit THEN
      RAISE EXCEPTION 'profit-excluded order: settled_net_profit is frozen'
        USING ERRCODE = '42501',
              HINT = 'Excluded orders never enter profit aggregates (decision K1).';
    END IF;
    IF NEW.profit_excluded_at IS DISTINCT FROM OLD.profit_excluded_at
       OR NEW.profit_exclusion_reason IS DISTINCT FROM OLD.profit_exclusion_reason THEN
      RAISE EXCEPTION 'profit exclusion is permanent'
        USING ERRCODE = '42501',
              HINT = 'Exclusion cannot be cleared or rewritten.';
    END IF;
  ELSIF NEW.profit_excluded_at IS NOT NULL AND OLD.estimated_net_profit IS NOT NULL THEN
    RAISE EXCEPTION 'calculated order cannot be excluded'
      USING ERRCODE = '42501',
            HINT = 'estimated_net_profit already written (write-once).';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_profit_freeze_breach ON orders;
CREATE TRIGGER trg_reject_profit_freeze_breach
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_profit_freeze_breach();
