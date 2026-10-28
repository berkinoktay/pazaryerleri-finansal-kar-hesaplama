-- DropIndex
DROP INDEX "product_variants_store_id_on_sale_archived_idx";

-- DropIndex
DROP INDEX "product_variants_store_id_stock_code_idx";

-- DropIndex
DROP INDEX "products_store_id_product_main_id_idx";

-- AlterTable
ALTER TABLE "product_variants" DROP COLUMN "archived",
DROP COLUMN "blacklisted",
DROP COLUMN "cost_price",
DROP COLUMN "fast_delivery_options",
DROP COLUMN "is_rush_delivery",
DROP COLUMN "location_based_delivery",
DROP COLUMN "locked",
DROP COLUMN "on_sale";

-- AlterTable
ALTER TABLE "products" DROP COLUMN "approved";
