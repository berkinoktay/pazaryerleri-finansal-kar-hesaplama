-- Drop the (store_id, barcode) unique constraint on product_variants.
--
-- Marketplaces enforce barcode uniqueness on their side at listing time,
-- but their sandbox accounts and certain real-world catalogs ship
-- variants with duplicate barcodes (multi-pack vs single-unit variants
-- of the same SKU). The DB-level uniqueness was failing 3 product
-- upserts per Trendyol sandbox sync — the affected products were being
-- silently dropped via skip-on-error in apps/sync-worker/src/handlers/
-- products.ts.
--
-- Lookups by barcode are non-unique in principle anyway; we resolve
-- variants via platformVariantId. The non-unique index is preserved for
-- query performance (admin search by barcode, future order-item
-- resolution fallbacks).
-- The schema declared `@@unique([storeId, barcode])`, but Prisma versions
-- have varied between materializing this as a UNIQUE CONSTRAINT
-- (introspected via pg_constraint) vs. a bare UNIQUE INDEX
-- (pg_indexes only). To work across both shapes, drop both forms — the
-- IF EXISTS clauses keep the migration idempotent regardless of which
-- form the target DB has.
ALTER TABLE "product_variants" DROP CONSTRAINT IF EXISTS "product_variants_store_id_barcode_key";
DROP INDEX IF EXISTS "product_variants_store_id_barcode_key";
CREATE INDEX "product_variants_store_id_barcode_idx" ON "product_variants" ("store_id", "barcode");
