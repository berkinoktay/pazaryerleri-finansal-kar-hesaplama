-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ProfitRecomputeReason" ADD VALUE 'DESI_CHANGED';
ALTER TYPE "ProfitRecomputeReason" ADD VALUE 'DAY_CLOSE';

-- AlterTable
ALTER TABLE "cost_profile_versions" ALTER COLUMN "effective_from" SET DEFAULT timezone('utc'::text, now());

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "seller_inputs_final_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "product_variant_cost_profiles" ALTER COLUMN "attached_at" SET DEFAULT timezone('utc'::text, now());

-- CreateTable
CREATE TABLE "cost_link_removals" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" UUID NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "attached_at" TIMESTAMP(3) NOT NULL,
    "detached_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_link_removals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variant_desi_changes" (
    "seq" BIGSERIAL NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL,
    "override_changed" BOOLEAN NOT NULL,
    "synced_changed" BOOLEAN NOT NULL,
    "old_override" DECIMAL(6,2),
    "new_override" DECIMAL(6,2),
    "old_synced" DECIMAL(6,2),
    "new_synced" DECIMAL(6,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variant_desi_changes_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE INDEX "cost_link_removals_organization_id_idx" ON "cost_link_removals"("organization_id");

-- CreateIndex
CREATE INDEX "cost_link_removals_product_variant_id_detached_at_idx" ON "cost_link_removals"("product_variant_id", "detached_at");

-- CreateIndex
CREATE INDEX "variant_desi_changes_organization_id_idx" ON "variant_desi_changes"("organization_id");

-- CreateIndex
CREATE INDEX "variant_desi_changes_product_variant_id_seq_idx" ON "variant_desi_changes"("product_variant_id", "seq");

-- CreateIndex
CREATE INDEX "orders_seller_inputs_final_at_order_date_idx" ON "orders"("seller_inputs_final_at", "order_date");

-- AddForeignKey
ALTER TABLE "cost_link_removals" ADD CONSTRAINT "cost_link_removals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_desi_changes" ADD CONSTRAINT "variant_desi_changes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_desi_changes" ADD CONSTRAINT "variant_desi_changes_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every order dated before the deploy day's Istanbul start is final.
-- Its link detaches and desi edits were never logged, so it must never be
-- re-derived. order_date is a UTC wall-clock timestamp without zone, hence the
-- double conversion: Istanbul local midnight -> the instant -> its UTC wall
-- clock. The marker carries the same UTC expression as every other stamp, so
-- the result does not depend on the session time zone.
UPDATE "orders"
SET "seller_inputs_final_at" = timezone('utc'::text, now())
WHERE "order_date" < ((date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul')
                       AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'UTC');
