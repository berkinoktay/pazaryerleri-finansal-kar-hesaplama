-- Reference seed extracted VERBATIM from Prisma migration
--   20260517085409_shipping_tariffs/migration.sql
-- during the 2026-07-08 migration-history baseline squash (the migration
-- folder was removed in favour of a single 0_init baseline). This file is
-- now owned by the db seed and test-support scripts, which read the marked
-- seed section out of it at runtime. Do NOT hand-edit the SQL below; it is
-- a byte-for-byte copy of the original migration body.

-- CreateEnum
CREATE TYPE "ShippingTariffSource" AS ENUM ('TRENDYOL_CONTRACT', 'OWN_CONTRACT');

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "default_shipping_carrier_id" UUID,
ADD COLUMN     "shipping_tariff_source" "ShippingTariffSource" NOT NULL DEFAULT 'TRENDYOL_CONTRACT';

-- CreateTable
CREATE TABLE "shipping_carriers" (
    "id" UUID NOT NULL,
    "platform" "Platform" NOT NULL,
    "external_id" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "tax_number" TEXT,
    "supports_barem_destek" BOOLEAN NOT NULL DEFAULT true,
    "max_barem_desi" INTEGER NOT NULL DEFAULT 10,
    "max_barem_eligible_delivery_duration" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_carriers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_desi_tariffs" (
    "id" UUID NOT NULL,
    "carrier_id" UUID NOT NULL,
    "desi" INTEGER NOT NULL,
    "price_net" DECIMAL(10,2) NOT NULL,
    "effective_from" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_desi_tariffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_barem_tariffs" (
    "id" UUID NOT NULL,
    "carrier_id" UUID NOT NULL,
    "min_order_amount" DECIMAL(12,2) NOT NULL,
    "max_order_amount" DECIMAL(12,2) NOT NULL,
    "price_net" DECIMAL(10,2) NOT NULL,
    "effective_from" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_barem_tariffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "own_shipping_tariffs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "desi" INTEGER NOT NULL,
    "price_net" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "own_shipping_tariffs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shipping_carriers_platform_active_idx" ON "shipping_carriers"("platform", "active");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_carriers_platform_external_id_key" ON "shipping_carriers"("platform", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_carriers_platform_code_key" ON "shipping_carriers"("platform", "code");

-- CreateIndex
CREATE INDEX "shipping_desi_tariffs_carrier_id_desi_idx" ON "shipping_desi_tariffs"("carrier_id", "desi");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_desi_tariffs_carrier_id_desi_key" ON "shipping_desi_tariffs"("carrier_id", "desi");

-- CreateIndex
CREATE INDEX "shipping_barem_tariffs_carrier_id_idx" ON "shipping_barem_tariffs"("carrier_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_barem_tariffs_carrier_id_min_order_amount_max_orde_key" ON "shipping_barem_tariffs"("carrier_id", "min_order_amount", "max_order_amount");

-- CreateIndex
CREATE INDEX "own_shipping_tariffs_organization_id_idx" ON "own_shipping_tariffs"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "own_shipping_tariffs_store_id_desi_key" ON "own_shipping_tariffs"("store_id", "desi");

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_default_shipping_carrier_id_fkey" FOREIGN KEY ("default_shipping_carrier_id") REFERENCES "shipping_carriers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_desi_tariffs" ADD CONSTRAINT "shipping_desi_tariffs_carrier_id_fkey" FOREIGN KEY ("carrier_id") REFERENCES "shipping_carriers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_barem_tariffs" ADD CONSTRAINT "shipping_barem_tariffs_carrier_id_fkey" FOREIGN KEY ("carrier_id") REFERENCES "shipping_carriers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "own_shipping_tariffs" ADD CONSTRAINT "own_shipping_tariffs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Seed: shipping_carriers — Trendyol getProviders authoritative list ───
INSERT INTO "shipping_carriers" (id, platform, external_id, code, display_name, tax_number, supports_barem_destek, max_barem_desi, max_barem_eligible_delivery_duration, sort_order, active, created_at, updated_at) VALUES
  (gen_random_uuid(), 'TRENDYOL',  4, 'YKMP',        'Yurtiçi Kargo',     '3130557669', true,  10, 1, 1,  true, now(), now()),
  (gen_random_uuid(), 'TRENDYOL',  7, 'ARASMP',      'Aras Kargo',        '720039666',  true,  10, 1, 2,  true, now(), now()),
  (gen_random_uuid(), 'TRENDYOL',  9, 'SURATMP',     'Sürat Kargo',       '7870233582', true,  10, 1, 3,  true, now(), now()),
  (gen_random_uuid(), 'TRENDYOL', 10, 'DHLECOMMP',   'DHL eCommerce',     '6080712084', true,  10, 1, 4,  true, now(), now()),
  (gen_random_uuid(), 'TRENDYOL', 17, 'TEXMP',       'Trendyol Express',  '8590921777', true,  10, 1, 5,  true, now(), now()),
  (gen_random_uuid(), 'TRENDYOL', 19, 'PTTMP',       'PTT Kargo',         '7320068060', true,  10, 1, 6,  true, now(), now()),
  (gen_random_uuid(), 'TRENDYOL', 38, 'SENDEOMP',    'Kolay Gelsin',      '2910804196', true,  10, 1, 7,  true, now(), now()),
  (gen_random_uuid(), 'TRENDYOL',  6, 'HOROZMP',     'Horoz Lojistik',    '4630097122', false, 10, 1, 9,  true, now(), now()),
  (gen_random_uuid(), 'TRENDYOL', 20, 'CEVAMP',      'CEVA',              '8450298557', false, 10, 1, 10, true, now(), now()),
  (gen_random_uuid(), 'TRENDYOL', 30, 'CEVATEDARIK', 'CEVA Tedarik',      '1800038254', false, 10, 1, 11, true, now(), now());

-- ─── Seed: shipping_desi_tariffs — Trendyol Anlaşmalı Kargo Fiyatları (15 Nisan 2026, KDV hariç TL) ───
WITH carriers AS (
  SELECT id, code FROM "shipping_carriers" WHERE platform = 'TRENDYOL'
),
tariff_data (carrier_code, desi, price_net) AS (
  VALUES
    ('ARASMP', 0, 83.93), ('ARASMP', 1, 83.93), ('ARASMP', 2, 83.93), ('ARASMP', 3, 95.12),
    ('ARASMP', 4, 103.68), ('ARASMP', 5, 111.17), ('ARASMP', 6, 121.12), ('ARASMP', 7, 128.46),
    ('ARASMP', 8, 137.05), ('ARASMP', 9, 144.91), ('ARASMP', 10, 153.48), ('ARASMP', 11, 161.77),
    ('ARASMP', 12, 167.73),
    ('DHLECOMMP', 0, 92.99), ('DHLECOMMP', 1, 92.99), ('DHLECOMMP', 2, 92.99), ('DHLECOMMP', 3, 103.99),
    ('DHLECOMMP', 4, 116.99), ('DHLECOMMP', 5, 129.99), ('DHLECOMMP', 6, 141.99), ('DHLECOMMP', 7, 149.99),
    ('DHLECOMMP', 8, 159.99), ('DHLECOMMP', 9, 169.99), ('DHLECOMMP', 10, 176.99), ('DHLECOMMP', 11, 184.99),
    ('DHLECOMMP', 12, 194.99),
    ('SENDEOMP', 0, 91.99), ('SENDEOMP', 1, 91.99), ('SENDEOMP', 2, 91.99), ('SENDEOMP', 3, 101.99),
    ('SENDEOMP', 4, 112.99), ('SENDEOMP', 5, 121.99), ('SENDEOMP', 6, 131.99), ('SENDEOMP', 7, 140.99),
    ('SENDEOMP', 8, 150.99), ('SENDEOMP', 9, 159.99), ('SENDEOMP', 10, 170.99), ('SENDEOMP', 11, 180.99),
    ('SENDEOMP', 12, 191.99),
    ('PTTMP', 0, 77.54), ('PTTMP', 1, 77.54), ('PTTMP', 2, 77.54), ('PTTMP', 3, 96.00),
    ('PTTMP', 4, 96.00), ('PTTMP', 5, 100.55), ('PTTMP', 6, 106.83), ('PTTMP', 7, 113.15),
    ('PTTMP', 8, 125.73), ('PTTMP', 9, 138.34), ('PTTMP', 10, 157.26), ('PTTMP', 11, 165.01),
    ('PTTMP', 12, 173.31),
    ('SURATMP', 0, 89.71), ('SURATMP', 1, 89.71), ('SURATMP', 2, 89.71), ('SURATMP', 3, 99.96),
    ('SURATMP', 4, 109.30), ('SURATMP', 5, 114.94), ('SURATMP', 6, 126.28), ('SURATMP', 7, 134.85),
    ('SURATMP', 8, 143.29), ('SURATMP', 9, 151.87), ('SURATMP', 10, 160.43), ('SURATMP', 11, 171.83),
    ('SURATMP', 12, 181.55),
    ('TEXMP', 0, 77.54), ('TEXMP', 1, 77.54), ('TEXMP', 2, 77.54), ('TEXMP', 3, 93.63),
    ('TEXMP', 4, 101.46), ('TEXMP', 5, 107.98), ('TEXMP', 6, 118.30), ('TEXMP', 7, 125.66),
    ('TEXMP', 8, 134.21), ('TEXMP', 9, 142.42), ('TEXMP', 10, 153.47), ('TEXMP', 11, 162.13),
    ('TEXMP', 12, 170.33),
    ('YKMP', 0, 112.77), ('YKMP', 1, 112.77), ('YKMP', 2, 112.77), ('YKMP', 3, 120.56),
    ('YKMP', 4, 123.15), ('YKMP', 5, 142.91), ('YKMP', 6, 149.82), ('YKMP', 7, 169.44),
    ('YKMP', 8, 175.96), ('YKMP', 9, 186.86), ('YKMP', 10, 195.12), ('YKMP', 11, 207.75),
    ('YKMP', 12, 220.80),
    ('CEVATEDARIK', 0, 494.22), ('CEVATEDARIK', 1, 494.22), ('CEVATEDARIK', 2, 494.22),
    ('CEVATEDARIK', 3, 494.22), ('CEVATEDARIK', 4, 494.22), ('CEVATEDARIK', 5, 494.22),
    ('CEVATEDARIK', 6, 494.22), ('CEVATEDARIK', 7, 494.22), ('CEVATEDARIK', 8, 494.22),
    ('CEVATEDARIK', 9, 494.22), ('CEVATEDARIK', 10, 494.22), ('CEVATEDARIK', 11, 494.22),
    ('CEVATEDARIK', 12, 494.22),
    ('CEVAMP', 0, 651.74), ('CEVAMP', 1, 651.74), ('CEVAMP', 2, 651.74),
    ('CEVAMP', 3, 651.74), ('CEVAMP', 4, 651.74), ('CEVAMP', 5, 651.74),
    ('CEVAMP', 6, 651.74), ('CEVAMP', 7, 651.74), ('CEVAMP', 8, 651.74),
    ('CEVAMP', 9, 651.74), ('CEVAMP', 10, 651.74), ('CEVAMP', 11, 651.74),
    ('CEVAMP', 12, 651.74),
    ('HOROZMP', 0, 599.13), ('HOROZMP', 1, 599.13), ('HOROZMP', 2, 599.13),
    ('HOROZMP', 3, 599.13), ('HOROZMP', 4, 599.13), ('HOROZMP', 5, 599.13),
    ('HOROZMP', 6, 599.13), ('HOROZMP', 7, 599.13), ('HOROZMP', 8, 599.13),
    ('HOROZMP', 9, 599.13), ('HOROZMP', 10, 599.13), ('HOROZMP', 11, 599.13),
    ('HOROZMP', 12, 599.13)
)
INSERT INTO "shipping_desi_tariffs" (id, carrier_id, desi, price_net, effective_from, created_at, updated_at)
SELECT gen_random_uuid(), c.id, td.desi, td.price_net, '2026-04-15'::date, now(), now()
FROM tariff_data td
JOIN carriers c ON c.code = td.carrier_code;

-- ─── Seed: shipping_barem_tariffs — Trendyol Kargo Barem Destek (26 Mart 2026, KDV hariç TL) ───
WITH carriers AS (
  SELECT id, code FROM "shipping_carriers" WHERE supports_barem_destek = true
),
-- minOrderAmount/maxOrderAmount both INCLUSIVE — DB matches Trendyol's
-- documented "0 - 199,99 TL" / "200 - 349,99 TL" tier wording exactly.
-- Service algorithm + SQL CTE use closed-interval comparison (gte/<=) so
-- 199.99 falls in tier 1 and 200.00 falls in tier 2, no overlap, no gap.
barem_data (carrier_code, min_amount, max_amount, price_net) AS (
  VALUES
    ('TEXMP',     0.00, 199.99, 34.16), ('PTTMP',     0.00, 199.99, 34.16),
    ('ARASMP',    0.00, 199.99, 42.91), ('SURATMP',   0.00, 199.99, 48.74),
    ('SENDEOMP',  0.00, 199.99, 51.24), ('DHLECOMMP', 0.00, 199.99, 52.08),
    ('YKMP',      0.00, 199.99, 74.58),
    ('TEXMP',     200.00, 349.99, 65.83), ('PTTMP',     200.00, 349.99, 65.83),
    ('ARASMP',    200.00, 349.99, 73.74), ('SURATMP',   200.00, 349.99, 79.58),
    ('SENDEOMP',  200.00, 349.99, 82.08), ('DHLECOMMP', 200.00, 349.99, 82.91),
    ('YKMP',      200.00, 349.99, 104.58)
)
INSERT INTO "shipping_barem_tariffs" (id, carrier_id, min_order_amount, max_order_amount, price_net, effective_from, created_at, updated_at)
SELECT gen_random_uuid(), c.id, bd.min_amount, bd.max_amount, bd.price_net, '2026-03-26'::date, now(), now()
FROM barem_data bd
JOIN carriers c ON c.code = bd.carrier_code;
