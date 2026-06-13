-- Desi (dimensional weight) sıfır-taban sözleşmesi (hand-written).
-- Karar (2026-06-13): Trendyol desiyi çoğu üründe hiç göndermez → kolon her
-- yerde NULL'dı ("ürünler sayfasında hepsi null geliyor"). Yeni kural:
--   • synced_dimensional_weight NON-NULL, default 0 (marketplace değeri yoksa 0)
--   • dimensional_weight (kullanıcı override) NULLABLE kalır (null = override yok)
--   • Hiçbir kolon 0'ın ALTINA inemez (CHECK) — negatif desi imkânsız.
-- Okuma yolu COALESCE(override, synced) olduğundan, synced=0 → ürünler sayfası
-- null yerine 0 gösterir. Desi 0 GEÇERLİ tarife kademesidir: kargo ücreti
-- shipping_desi_tariffs / own_shipping_tariffs'ten (kargo firması + ceil(desi))
-- eşleştirilir, tablo desi 0'dan itibaren kapsar → desi-0 ürün de gerçek
-- (en alt kademe) kargo ücretini alır.

-- Backfill: mevcut tüm NULL synced satırları 0'a çek (Trendyol hiç göndermemişti).
UPDATE product_variants SET synced_dimensional_weight = 0 WHERE synced_dimensional_weight IS NULL;

-- AlterColumn: default 0 + NOT NULL (backfill'den SONRA güvenli).
ALTER TABLE product_variants ALTER COLUMN synced_dimensional_weight SET DEFAULT 0;
ALTER TABLE product_variants ALTER COLUMN synced_dimensional_weight SET NOT NULL;

-- Taban: hiçbir desi 0'ın altına inemez. synced her zaman var (>= 0);
-- override varsa o da >= 0. Mirror: supabase/sql/check-constraints.sql.
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_dimensional_weight_nonneg_check;
ALTER TABLE product_variants ADD CONSTRAINT product_variants_dimensional_weight_nonneg_check
  CHECK (synced_dimensional_weight >= 0 AND (dimensional_weight IS NULL OR dimensional_weight >= 0));
