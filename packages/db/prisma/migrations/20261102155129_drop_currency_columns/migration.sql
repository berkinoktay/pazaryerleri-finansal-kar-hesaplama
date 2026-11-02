-- DropForeignKey
ALTER TABLE "order_item_cost_snapshot_components" DROP CONSTRAINT "order_item_cost_snapshot_components_order_item_id_fkey";

-- DropForeignKey
ALTER TABLE "order_item_cost_snapshot_components" DROP CONSTRAINT "order_item_cost_snapshot_components_profile_id_fkey";

-- AlterTable
ALTER TABLE "cost_profile_versions" DROP COLUMN "currency",
DROP COLUMN "fx_rate_mode",
DROP COLUMN "manual_fx_rate";

-- AlterTable
ALTER TABLE "cost_profiles" DROP COLUMN "currency",
DROP COLUMN "fx_rate_mode",
DROP COLUMN "manual_fx_rate";

-- AlterTable
ALTER TABLE "organizations" DROP COLUMN "currency";

-- DropTable
DROP TABLE "fx_rates";

-- DropTable
DROP TABLE "order_item_cost_snapshot_components";

-- DropEnum
DROP TYPE "Currency";

-- DropEnum
DROP TYPE "FxRateMode";
