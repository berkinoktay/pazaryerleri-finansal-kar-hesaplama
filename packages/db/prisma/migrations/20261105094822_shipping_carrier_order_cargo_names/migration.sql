-- AlterTable
ALTER TABLE "shipping_carriers" ADD COLUMN     "order_cargo_names" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill: the exact cargoProviderName values Trendyol writes on orders/packages
-- for each seeded carrier (the getProviders "Name" column). The order profit path
-- matches an order's cargo name against these OR the carrier's display name, so a
-- real order carrying "PTT Kargo Marketplace" resolves to PTTMP even though its
-- display name is the short "PTT Kargo". Turkish letters are written as Unicode
-- escapes (PostgreSQL U&'...') to keep this file ASCII-safe.
UPDATE "shipping_carriers" SET "order_cargo_names" = ARRAY[U&'Yurti\00E7i Kargo Marketplace'] WHERE "platform" = 'TRENDYOL' AND "code" = 'YKMP';
UPDATE "shipping_carriers" SET "order_cargo_names" = ARRAY['Aras Kargo Marketplace'] WHERE "platform" = 'TRENDYOL' AND "code" = 'ARASMP';
UPDATE "shipping_carriers" SET "order_cargo_names" = ARRAY[U&'S\00FCrat Kargo Marketplace'] WHERE "platform" = 'TRENDYOL' AND "code" = 'SURATMP';
UPDATE "shipping_carriers" SET "order_cargo_names" = ARRAY['DHL eCommerce Marketplace'] WHERE "platform" = 'TRENDYOL' AND "code" = 'DHLECOMMP';
UPDATE "shipping_carriers" SET "order_cargo_names" = ARRAY['Trendyol Express Marketplace'] WHERE "platform" = 'TRENDYOL' AND "code" = 'TEXMP';
UPDATE "shipping_carriers" SET "order_cargo_names" = ARRAY['PTT Kargo Marketplace'] WHERE "platform" = 'TRENDYOL' AND "code" = 'PTTMP';
UPDATE "shipping_carriers" SET "order_cargo_names" = ARRAY['Kolay Gelsin Marketplace'] WHERE "platform" = 'TRENDYOL' AND "code" = 'SENDEOMP';
UPDATE "shipping_carriers" SET "order_cargo_names" = ARRAY['Horoz Kargo Marketplace'] WHERE "platform" = 'TRENDYOL' AND "code" = 'HOROZMP';
UPDATE "shipping_carriers" SET "order_cargo_names" = ARRAY['CEVA Marketplace'] WHERE "platform" = 'TRENDYOL' AND "code" = 'CEVAMP';
UPDATE "shipping_carriers" SET "order_cargo_names" = ARRAY['Ceva Tedarik Marketplace'] WHERE "platform" = 'TRENDYOL' AND "code" = 'CEVATEDARIK';
