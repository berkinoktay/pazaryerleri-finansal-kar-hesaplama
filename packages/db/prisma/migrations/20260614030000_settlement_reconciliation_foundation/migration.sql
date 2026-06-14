-- Hakediş Kontrolü TEMELİ (2026-06-14): settlement actual-satış çıpası.
--
-- Karar: estimated/settled kâr = satıcının HAK ETTİĞİ tutar (effectiveSale +
-- yetkili komisyon/kargo). Trendyol'un GERÇEKTE ÖDEDİĞİ değil; underpaid'e sessizce
-- ÇEKİLMEZ. Beklenen-vs-gerçek farkı gelecek "Hakediş Kontrolü" epiğinde itiraz-
-- edilebilir kalem olur. Bu kolon o mutabakatın actual-satış çıpası: handleSale
-- Trendyol'un Sale settlement `credit`'ini (gerçek kredilenen satış) buraya yazar.
-- Kâra GİRMEZ (additive, davranış-nötr). Nullable: settlement gelmeden önce boş.

ALTER TABLE "order_items" ADD COLUMN "settled_sale_amount" DECIMAL(12,2);
