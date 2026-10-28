-- Expand step: one mutually exclusive listing status per product variant.
--
-- Adds the ProductVariantStatus enum, product_variants.status (NOT NULL,
-- default ON_SALE), product_variants.status_reason and a (store_id, status)
-- index. The legacy on_sale / archived / blacklisted / locked booleans stay
-- until the follow-up contract migration drops them. The catalog sync is the
-- only writer of both new columns and always sets status explicitly; the
-- ON_SALE default only keeps other inserts (seed, test factories) valid.
-- No RLS change: the existing row policy on product_variants
-- (product_variants_org_member_read) also covers the new columns.
--
-- The table is small at the time of this migration and has no production
-- traffic yet, so a plain CREATE INDEX (created before the backfill) and a
-- single-statement UPDATE are used: no CONCURRENTLY, no batching.

-- CreateEnum
CREATE TYPE "ProductVariantStatus" AS ENUM ('ON_SALE', 'NOT_ON_SALE', 'LOCKED', 'BLACKLISTED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "status" "ProductVariantStatus" NOT NULL DEFAULT 'ON_SALE',
ADD COLUMN     "status_reason" TEXT;

-- CreateIndex
CREATE INDEX "product_variants_store_id_status_idx" ON "product_variants"("store_id", "status");

-- Backfill from the legacy flags. Same precedence as deriveVariantStatus in
-- packages/marketplace/src/trendyol/mapper.ts: archived, then blacklisted,
-- then locked, then on_sale, otherwise NOT_ON_SALE. status_reason stays NULL
-- because lock and blacklist reasons were never stored; the next full catalog
-- scan writes them. updated_at is left untouched on purpose: no synced value
-- changed, only its representation.
UPDATE "product_variants"
SET "status" = (
  CASE
    WHEN "archived" THEN 'ARCHIVED'
    WHEN "blacklisted" THEN 'BLACKLISTED'
    WHEN "locked" THEN 'LOCKED'
    WHEN "on_sale" THEN 'ON_SALE'
    ELSE 'NOT_ON_SALE'
  END
)::"ProductVariantStatus";
