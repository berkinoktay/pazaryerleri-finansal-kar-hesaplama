-- DropIndex
DROP INDEX "shipping_barem_tariffs_carrier_id_min_order_amount_max_orde_key";

-- DropIndex
DROP INDEX "shipping_desi_tariffs_carrier_id_desi_key";

-- AlterTable
ALTER TABLE "micro_export_return_fee_tiers" ADD COLUMN     "version_id" UUID;

-- AlterTable
ALTER TABLE "shipping_barem_tariffs" ADD COLUMN     "version_id" UUID;

-- AlterTable
ALTER TABLE "shipping_desi_tariffs" ADD COLUMN     "version_id" UUID;

-- CreateTable
CREATE TABLE "shipping_tariff_versions" (
    "id" UUID NOT NULL,
    "carrier_id" UUID NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "supports_barem_destek" BOOLEAN NOT NULL,
    "max_barem_desi" INTEGER NOT NULL,
    "max_barem_eligible_delivery_duration" INTEGER NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_tariff_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "micro_export_return_fee_tier_versions" (
    "id" UUID NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "micro_export_return_fee_tier_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shipping_tariff_versions_carrier_id_effective_from_key" ON "shipping_tariff_versions"("carrier_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "micro_export_return_fee_tier_versions_effective_from_key" ON "micro_export_return_fee_tier_versions"("effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_barem_tariffs_version_id_min_order_amount_max_orde_key" ON "shipping_barem_tariffs"("version_id", "min_order_amount", "max_order_amount");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_desi_tariffs_version_id_desi_key" ON "shipping_desi_tariffs"("version_id", "desi");

-- AddForeignKey
ALTER TABLE "shipping_desi_tariffs" ADD CONSTRAINT "shipping_desi_tariffs_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "shipping_tariff_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_barem_tariffs" ADD CONSTRAINT "shipping_barem_tariffs_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "shipping_tariff_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "micro_export_return_fee_tiers" ADD CONSTRAINT "micro_export_return_fee_tiers_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "micro_export_return_fee_tier_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_tariff_versions" ADD CONSTRAINT "shipping_tariff_versions_carrier_id_fkey" FOREIGN KEY ("carrier_id") REFERENCES "shipping_carriers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One version per carrier, open towards the past so historic orders keep a tariff
-- (plan decision 2). Barem attributes move from the carrier onto the version.
INSERT INTO "shipping_tariff_versions" ("id", "carrier_id", "effective_from",
  "supports_barem_destek", "max_barem_desi", "max_barem_eligible_delivery_duration",
  "created_at", "updated_at")
SELECT gen_random_uuid(), sc."id", TIMESTAMP '2000-01-01 00:00:00',
  sc."supports_barem_destek", sc."max_barem_desi", sc."max_barem_eligible_delivery_duration",
  now(), now()
FROM "shipping_carriers" sc;

UPDATE "shipping_desi_tariffs" d SET "version_id" = v."id"
FROM "shipping_tariff_versions" v WHERE v."carrier_id" = d."carrier_id";
UPDATE "shipping_barem_tariffs" b SET "version_id" = v."id"
FROM "shipping_tariff_versions" v WHERE v."carrier_id" = b."carrier_id";

-- Micro-export tiers: today every band shares one effective_from date. Refuse to
-- migrate anything else rather than guess how bands combine into sets.
DO $$
BEGIN
  IF (SELECT count(DISTINCT "effective_from") FROM "micro_export_return_fee_tiers") > 1 THEN
    RAISE EXCEPTION 'micro_export_return_fee_tiers has more than one effective_from; migrate by hand';
  END IF;
END $$;

-- The version starts at Istanbul midnight of the stored date, stored as a UTC instant.
INSERT INTO "micro_export_return_fee_tier_versions" ("id", "effective_from", "created_at", "updated_at")
SELECT gen_random_uuid(),
  ("effective_from"::timestamp AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'UTC', now(), now()
FROM (SELECT DISTINCT "effective_from" FROM "micro_export_return_fee_tiers") d;

UPDATE "micro_export_return_fee_tiers" t SET "version_id" = v."id"
FROM "micro_export_return_fee_tier_versions" v;
