-- PR-5c (2026-05-19): Eski Order ücret kolonları silindi (design §9 PR-5c).
-- Yeni convention: saleSubtotalNet + saleVatTotal (PR-5a) + OrderFee tablosu
-- (PR-1, per-paket ücretler) + OrderItem.grossCommission*/refundedCommission*
-- (PR-3, satır-seviye komisyon). netProfit → estimatedNetProfit + settledNetProfit
-- (PR-5a, write-once + mutable).
--
-- PR-5b iptal edildi (production order data yok, sync dormant) — bu silme
-- backfill öncesi yapılır, veri kaybı YOK (Trendyol order sync ayrı epic'te
-- yeni schema'ya yazacak).

-- AlterTable
ALTER TABLE "orders" DROP COLUMN "commission_amount",
DROP COLUMN "net_profit",
DROP COLUMN "platform_fee",
DROP COLUMN "shipping_cost",
DROP COLUMN "total_amount",
DROP COLUMN "vat_amount";
