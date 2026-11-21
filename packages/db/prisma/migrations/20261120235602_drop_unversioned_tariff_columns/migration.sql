-- DropForeignKey
ALTER TABLE "shipping_barem_tariffs" DROP CONSTRAINT "shipping_barem_tariffs_carrier_id_fkey";

-- DropForeignKey
ALTER TABLE "shipping_desi_tariffs" DROP CONSTRAINT "shipping_desi_tariffs_carrier_id_fkey";

-- DropIndex
DROP INDEX "micro_export_return_fee_tiers_min_sale_gross_max_sale_gross_idx";

-- DropIndex
DROP INDEX "micro_export_return_fee_tiers_min_sale_gross_max_sale_gross_key";

-- DropIndex
DROP INDEX "shipping_barem_tariffs_carrier_id_idx";

-- DropIndex
DROP INDEX "shipping_desi_tariffs_carrier_id_desi_idx";

-- AlterTable
ALTER TABLE "micro_export_return_fee_tiers" DROP COLUMN "effective_from",
ALTER COLUMN "version_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "shipping_barem_tariffs" DROP COLUMN "carrier_id",
DROP COLUMN "effective_from",
ALTER COLUMN "version_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "shipping_carriers" DROP COLUMN "max_barem_desi",
DROP COLUMN "max_barem_eligible_delivery_duration",
DROP COLUMN "supports_barem_destek";

-- AlterTable
ALTER TABLE "shipping_desi_tariffs" DROP COLUMN "carrier_id",
DROP COLUMN "effective_from",
ALTER COLUMN "version_id" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "micro_export_return_fee_tiers_version_id_min_sale_gross_max_key" ON "micro_export_return_fee_tiers"("version_id", "min_sale_gross", "max_sale_gross");
