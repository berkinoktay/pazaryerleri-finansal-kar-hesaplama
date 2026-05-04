-- AlterTable
ALTER TABLE "products" ADD COLUMN     "total_stock" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "products_store_id_total_stock_idx" ON "products"("store_id", "total_stock");

-- Backfill total_stock for existing products from their current variants.
-- One-shot: subsequent updates flow through the sync worker.
UPDATE "products" p
SET "total_stock" = COALESCE((
  SELECT SUM(v."quantity")
  FROM "product_variants" v
  WHERE v."product_id" = p."id"
), 0);
