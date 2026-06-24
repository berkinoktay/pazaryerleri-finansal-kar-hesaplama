-- Mikro ihracat (Trendyol marketplace `micro=true`) ücret tipleri.
-- INTERNATIONAL_SERVICE: ürün satışı üzerinden %6 KDV-dahil "Uluslararası Hizmet Bedeli"
--   (PSF mikro ihracatta uygulanmaz; bunun yerine bu ücret kesilir; 16.07.2024'ten beri).
-- OVERSEAS_RETURN_OPERATION: iadede (satış−komisyon)×%35/%30 "Yurt Dışı İade Operasyon Bedeli".
-- Yeni enum değerlerinin SEED INSERT'i ayrı bir migration'dadır (PostgreSQL: yeni enum
-- değeri aynı transaction'da kullanılamaz). Seed: 20260624120100_international_service_fee_seed.
ALTER TYPE "OrderFeeType" ADD VALUE 'INTERNATIONAL_SERVICE';
ALTER TYPE "OrderFeeType" ADD VALUE 'OVERSEAS_RETURN_OPERATION';
