-- AlterTable
ALTER TABLE "products" ADD COLUMN     "image_urls" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill: copy each product's image rows into image_urls in their old display order before the table is dropped.
UPDATE "products" p SET "image_urls" = i.urls FROM (SELECT "product_id", array_agg("url" ORDER BY "position", "created_at", "id") AS urls FROM "product_images" GROUP BY "product_id") i WHERE p."id" = i."product_id";

-- DropForeignKey
ALTER TABLE "product_images" DROP CONSTRAINT "product_images_product_id_fkey";

-- DropTable
DROP TABLE "product_images";
