-- Rename product_variants.dimensional_weight to dimensional_weight_override.
--
-- The column holds the seller's manual desi override (null = no override, the
-- marketplace value in synced_dimensional_weight applies). The new name says
-- what it is, next to synced_dimensional_weight, so the products page's
-- "missing desi" rule (override IS NULL AND synced = 0) reads unambiguously.
--
-- Hand-written: Prisma never infers a rename, and its generated
-- DROP COLUMN + ADD COLUMN would erase every seller override. RENAME COLUMN
-- keeps the data, the type (DECIMAL(6,2)) and the nullability.
--
-- The non-negative CHECK on both desi columns is re-created under a name that
-- matches the new column. Postgres rewrites a CHECK expression on RENAME COLUMN
-- but keeps the old constraint name, so the old one is dropped first. IF EXISTS
-- is required: the constraint lives in supabase/sql/check-constraints.sql
-- (applied by apply-policies), so a fresh migration replay (db:check-drift,
-- db:migration:new) does not have it. check-constraints.sql defines the same
-- constraint, so apply-policies stays idempotent after this migration.
--
-- No RLS change: the existing row policy on product_variants covers the renamed
-- column. The table is small and has no production traffic yet, so a plain
-- ADD CONSTRAINT (with its validation scan) is used.

ALTER TABLE "product_variants" DROP CONSTRAINT IF EXISTS "product_variants_dimensional_weight_nonneg_check";

ALTER TABLE "product_variants" RENAME COLUMN "dimensional_weight" TO "dimensional_weight_override";

ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_dimensional_weight_override_nonneg_check" CHECK (synced_dimensional_weight >= 0 AND (dimensional_weight_override IS NULL OR dimensional_weight_override >= 0));
