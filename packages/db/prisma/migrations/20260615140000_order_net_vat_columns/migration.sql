-- Net KDV persist kolonları (2026-06-15). computeProfit zaten netVat (output − input
-- KDV) üretiyordu ama atılıyordu; artık estimatedNetProfit / settledNetProfit ile
-- birlikte yazılır → order detail endpoint kâr dökümünde "Net KDV" satırını backend-
-- hesaplı servis eder (frontend ASLA türetmez). Additive, nullable. Net KDV negatif
-- olabilir (input > output) → CHECK yok.
--
-- BACKFILL YOK (bilinçli): bu migration'dan ÖNCE estimate'i hesaplanmış siparişlerde
-- estimated_net_vat null kalır → order detail profitBreakdown null döner (kâr dökümü
-- "hesaplanmadı" gösterir) ta ki applyEstimateOnOrderCreate yeniden çalışana dek (her
-- re-sync'te netVat'ı da yazar → self-heal). Dev'de truncate/re-sync sık olduğundan
-- pencere küçük. Re-sync olmayan stabil tarihsel sipariş bulunan bir ortam olursa
-- backfill (estimated_net_profit IS NOT NULL AND estimated_net_vat IS NULL satırlarını
-- re-sync) gerekebilir.
ALTER TABLE "orders"
  ADD COLUMN "estimated_net_vat" DECIMAL(12, 2),
  ADD COLUMN "settled_net_vat" DECIMAL(12, 2);

-- reject_profit_freeze_breach: kâr-dondurma sözleşmesi artık net_vat kolonlarını da
-- kapsar (kâr-dışı siparişte estimated/settled net_vat donuk). Mirror: supabase/sql/triggers.sql.
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
    IF NEW.estimated_net_vat IS DISTINCT FROM OLD.estimated_net_vat THEN
      RAISE EXCEPTION 'profit-excluded order: estimated_net_vat is frozen'
        USING ERRCODE = '42501',
              HINT = 'Net VAT follows the profit-freeze contract (display-only, never re-derived).';
    END IF;
    IF NEW.settled_net_vat IS DISTINCT FROM OLD.settled_net_vat THEN
      RAISE EXCEPTION 'profit-excluded order: settled_net_vat is frozen'
        USING ERRCODE = '42501',
              HINT = 'Net VAT follows the profit-freeze contract (display-only, never re-derived).';
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
            HINT = 'Calculated profit already in aggregates; excluding would rewrite history.';
  END IF;
  RETURN NEW;
END;
$$;
