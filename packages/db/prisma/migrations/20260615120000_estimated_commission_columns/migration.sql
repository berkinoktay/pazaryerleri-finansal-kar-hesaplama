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
