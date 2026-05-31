-- Denormalize MIN/MAX(variants[*].sale_price) onto products (Advanced
-- Filtering PR-B1). Prisma 7 cannot MAX() over a Decimal child relation in
-- orderBy, so the products-list sort=salePrice fell back to platform_created_at
-- (a documented limitation). These columns replace that fallback and back the
-- upcoming salePrice range filter (PR-B2, overlap test against both bounds).
--
-- Maintained transactionally by the sync worker inside upsertBatch alongside
-- total_stock (apps/sync-worker/src/handlers/products.ts) — NOT a trigger, so
-- the worker stays the single writer for product rows. Nullable: a product with
-- zero variants has no price; everything else is backfilled below.

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "min_sale_price" DECIMAL(12,2),
ADD COLUMN     "max_sale_price" DECIMAL(12,2);

-- CreateIndex
CREATE INDEX "products_store_id_min_sale_price_max_sale_price_idx" ON "products"("store_id", "min_sale_price", "max_sale_price");

-- Backfill existing rows: per product, the min/max sale_price across its
-- variants. Products with no variants stay NULL (correct — no price to show).
UPDATE "products" AS p
SET "min_sale_price" = agg.min_price,
    "max_sale_price" = agg.max_price
FROM (
  SELECT "product_id",
         MIN("sale_price") AS min_price,
         MAX("sale_price") AS max_price
  FROM "product_variants"
  GROUP BY "product_id"
) AS agg
WHERE p."id" = agg."product_id";
