-- CreateEnum
CREATE TYPE "SnapshotDesiSource" AS ENUM ('OVERRIDE', 'SYNCED');

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "profit_snapshot_at" TIMESTAMP(3),
ADD COLUMN     "snapshot_brand_id" BIGINT,
ADD COLUMN     "snapshot_category_brand_rate_pct" DECIMAL(5,2),
ADD COLUMN     "snapshot_category_id" BIGINT,
ADD COLUMN     "snapshot_category_rate_pct" DECIMAL(5,2),
ADD COLUMN     "snapshot_cost_profile_version_ids" UUID[] DEFAULT ARRAY[]::UUID[],
ADD COLUMN     "snapshot_desi_source" "SnapshotDesiSource",
ADD COLUMN     "snapshot_is_digital" BOOLEAN,
ADD COLUMN     "snapshot_product_variant_id" UUID,
ADD COLUMN     "snapshot_synced_commission_rate_pct" DECIMAL(5,2),
ADD COLUMN     "snapshot_unit_desi" DECIMAL(6,2);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "profit_snapshot_at" TIMESTAMP(3),
ADD COLUMN     "snapshot_cargo_provider_name" TEXT,
ADD COLUMN     "snapshot_carrier_id" UUID,
ADD COLUMN     "snapshot_shipping_tariff_source" "ShippingTariffSource";

-- CreateIndex
CREATE INDEX "orders_snapshot_carrier_id_idx" ON "orders"("snapshot_carrier_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_snapshot_carrier_id_fkey" FOREIGN KEY ("snapshot_carrier_id") REFERENCES "shipping_carriers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
