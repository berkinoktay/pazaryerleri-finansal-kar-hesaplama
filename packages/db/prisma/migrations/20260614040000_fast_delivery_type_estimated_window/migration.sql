-- Hızlı-teslim (fastDeliveryType) doğrulama — CAPTURE (2026-06-14, additive davranış-nötr).
--
-- Hibrit tasarım (Berkin onaylı): "fast mı + hangi tip" sipariş-seviyesinden
-- (order.fastDelivery + fastDeliveryType — PROD'da dolu; stage test siparişleri ""),
-- SameDayShipping cutoff'u üründen (variant.fastDeliveryOptions). Per-tip kriter (Faz 2)
-- bu kolonları tüketecek; bu PR yalnız YAKALAR (henüz tüketen yok → davranış-nötr).
--
-- fast_delivery_type: "TodayDelivery"|"SameDayShipping"|"FastDelivery"; boş "" → null (mapper).
-- estimated_delivery_{start,end}_date: getShipmentPackages tahmini teslim penceresi
--   (PROD'da dolu — gözlem 11314118846; stage'de 0 → null).

ALTER TABLE "orders" ADD COLUMN "fast_delivery_type" TEXT;
ALTER TABLE "orders" ADD COLUMN "estimated_delivery_start_date" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN "estimated_delivery_end_date" TIMESTAMP(3);
