-- actualShipDate yakalama (2026-06-14, additive davranış-nötr).
--
-- SameDayShipping ("Bugün Kargoda") PSF indirimi (6.99 vs 10.99) kriterinin tabanı:
-- gönderi "taşıma durumuna geçiş" (Shipped status) anı. Trendyol resmi kuralı:
-- 6.99 yalnız Bugün Kargoda etiketli + termin içinde taşıma durumuna geçen gönderilerde.
-- Kriter aynı-gün SEVK bazlı (TESLİM değil). Bu kolon packageHistories[Shipped].createdDate.
--
-- NOT: origin_shipment_date "kargoya-hazır anı" (≈ sipariş) → gerçek sevk DEĞİL; bu yüzden
-- ayrı kolon. Henüz tüketen yok (capture, PR2a) → davranış-nötr; PR2b kriteri tüketecek.

ALTER TABLE "orders" ADD COLUMN "actual_ship_date" TIMESTAMP(3);
