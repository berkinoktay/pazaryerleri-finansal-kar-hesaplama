-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "dimensional_weight" DECIMAL(6,2),
ADD COLUMN     "synced_dimensional_weight" DECIMAL(6,2);
