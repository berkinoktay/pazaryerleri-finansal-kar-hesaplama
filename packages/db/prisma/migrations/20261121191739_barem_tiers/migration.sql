-- CreateEnum
CREATE TYPE "BaremTier" AS ENUM ('TABLE_1', 'TABLE_2');

-- DropIndex
DROP INDEX "shipping_barem_tariffs_version_id_min_order_amount_max_orde_key";

-- AlterTable
ALTER TABLE "shipping_barem_tariffs" ADD COLUMN     "tier" "BaremTier" NOT NULL DEFAULT 'TABLE_1';

-- AlterTable
ALTER TABLE "shipping_tariff_versions" ADD COLUMN     "barem_applies_to_returns" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "shipping_barem_tariffs_version_id_tier_min_order_amount_max_key" ON "shipping_barem_tariffs"("version_id", "tier", "min_order_amount", "max_order_amount");
