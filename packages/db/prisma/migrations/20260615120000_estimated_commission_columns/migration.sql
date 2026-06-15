-- Komisyon TAHMİNİ donuk kopyası kolonları (estimate preservation, 2026-06-15).
-- grossCommission*/refundedCommission* settlement Sale/Discount satırı geldiğinde
-- Trendyol'un gerçek değeriyle overwrite edilir; bu kolonlar mapper'ın T+0 tahminini
-- KORUR → Hakediş Kontrolü ekranı tahmin-vs-gerçek karşılaştırması + komisyon-oran
-- sapması (denetim A #331 DB-driven KDV) görünür olsun. Yalnız gerçekten tahmin
-- ettiğimiz 2 değer (gross + refunded komisyon); satıcı indirimi siparişten okunur
-- + effectiveSale'e gömülü → tutulmaz. Additive, nullable, backfill yok.
ALTER TABLE "order_items"
  ADD COLUMN "estimated_gross_commission_amount_net" DECIMAL(12, 2),
  ADD COLUMN "estimated_gross_commission_vat_amount" DECIMAL(12, 2),
  ADD COLUMN "estimated_refunded_commission_amount_net" DECIMAL(12, 2),
  ADD COLUMN "estimated_refunded_commission_vat_amount" DECIMAL(12, 2);

-- Mirror of the working-column invariant (refunded ≤ gross) for the frozen
-- estimate pair. Today intake writes the estimate byte-identical to the working
-- columns (which already satisfy the check), so no violation is reachable — but
-- the repo pattern keeps every money invariant in the DB so a FUTURE separate
-- write path (reconcile/backfill) cannot open a gap. Nullable-safe: pre-change
-- rows + not-yet-intaken rows are NULL on either side and pass. Mirrored in
-- supabase/sql/check-constraints.sql.
ALTER TABLE "order_items" DROP CONSTRAINT IF EXISTS order_items_estimated_refunded_commission_check;
ALTER TABLE "order_items" ADD CONSTRAINT order_items_estimated_refunded_commission_check
  CHECK (estimated_refunded_commission_amount_net IS NULL
         OR estimated_gross_commission_amount_net IS NULL
         OR estimated_refunded_commission_amount_net <= estimated_gross_commission_amount_net);
