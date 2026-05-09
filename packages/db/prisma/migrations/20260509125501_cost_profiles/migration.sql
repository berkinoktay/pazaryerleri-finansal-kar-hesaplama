-- CreateEnum
CREATE TYPE "CostProfileType" AS ENUM ('COGS', 'PACKAGING', 'SHIPPING', 'SOFTWARE', 'MARKETING', 'OTHER');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('TRY', 'USD', 'EUR');

-- CreateEnum
CREATE TYPE "FxRateMode" AS ENUM ('AUTO', 'MANUAL');

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "organization_id" UUID,
ADD COLUMN     "snapshot_captured_at" TIMESTAMP(3),
ADD COLUMN     "unit_cost_snapshot" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "cost_profiles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CostProfileType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'TRY',
    "vat_rate" INTEGER NOT NULL DEFAULT 0,
    "fx_rate_mode" "FxRateMode" NOT NULL DEFAULT 'AUTO',
    "manual_fx_rate" DECIMAL(14,6),
    "note" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_profile_versions" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CostProfileType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "vat_rate" INTEGER NOT NULL,
    "fx_rate_mode" "FxRateMode" NOT NULL,
    "manual_fx_rate" DECIMAL(14,6),
    "note" TEXT,
    "archived_at" TIMESTAMP(3),
    "changed_fields" TEXT[],
    "changed_by" UUID,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "change_reason" TEXT,

    CONSTRAINT "cost_profile_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variant_cost_profiles" (
    "id" UUID NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "attached_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attached_by" UUID,

    CONSTRAINT "product_variant_cost_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item_cost_snapshot_components" (
    "id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "profile_name" TEXT NOT NULL,
    "profile_type" "CostProfileType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "vat_rate" INTEGER NOT NULL,
    "amount_in_try" DECIMAL(12,2) NOT NULL,
    "fx_rate_mode" "FxRateMode" NOT NULL,
    "fx_rate_used" DECIMAL(14,6) NOT NULL,
    "fx_rate_source" TEXT NOT NULL,

    CONSTRAINT "order_item_cost_snapshot_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_rates" (
    "id" UUID NOT NULL,
    "currency" "Currency" NOT NULL,
    "rate_date" DATE NOT NULL,
    "rate_to_try" DECIMAL(14,6) NOT NULL,
    "source" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cost_profiles_organization_id_archived_at_idx" ON "cost_profiles"("organization_id", "archived_at");

-- CreateIndex
CREATE INDEX "cost_profiles_organization_id_type_idx" ON "cost_profiles"("organization_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "cost_profiles_organization_id_name_key" ON "cost_profiles"("organization_id", "name");

-- CreateIndex
CREATE INDEX "cost_profile_versions_profile_id_changed_at_idx" ON "cost_profile_versions"("profile_id", "changed_at" DESC);

-- CreateIndex
CREATE INDEX "cost_profile_versions_organization_id_idx" ON "cost_profile_versions"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "cost_profile_versions_profile_id_version_key" ON "cost_profile_versions"("profile_id", "version");

-- CreateIndex
CREATE INDEX "product_variant_cost_profiles_profile_id_idx" ON "product_variant_cost_profiles"("profile_id");

-- CreateIndex
CREATE INDEX "idx_pvcp_org_product_variant" ON "product_variant_cost_profiles"("organization_id", "product_variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variant_cost_profiles_product_variant_id_profile_id_key" ON "product_variant_cost_profiles"("product_variant_id", "profile_id");

-- CreateIndex
CREATE INDEX "order_item_cost_snapshot_components_order_item_id_idx" ON "order_item_cost_snapshot_components"("order_item_id");

-- CreateIndex
CREATE INDEX "idx_oi_cost_snapshot_org_profile_type" ON "order_item_cost_snapshot_components"("organization_id", "profile_type");

-- CreateIndex
CREATE INDEX "idx_oi_cost_snapshot_org_profile_id" ON "order_item_cost_snapshot_components"("organization_id", "profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "fx_rates_currency_rate_date_key" ON "fx_rates"("currency", "rate_date");

-- CreateIndex
CREATE INDEX "order_items_organization_id_snapshot_captured_at_idx" ON "order_items"("organization_id", "snapshot_captured_at");

-- AddForeignKey
ALTER TABLE "cost_profiles" ADD CONSTRAINT "cost_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_profile_versions" ADD CONSTRAINT "cost_profile_versions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "cost_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variant_cost_profiles" ADD CONSTRAINT "product_variant_cost_profiles_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variant_cost_profiles" ADD CONSTRAINT "product_variant_cost_profiles_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "cost_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_cost_snapshot_components" ADD CONSTRAINT "order_item_cost_snapshot_components_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_cost_snapshot_components" ADD CONSTRAINT "order_item_cost_snapshot_components_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "cost_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill order_items.organization_id from parent orders.
-- The new column is nullable; for existing rows, copy from the parent Order.
UPDATE order_items oi
SET organization_id = o.organization_id
FROM orders o
WHERE oi.order_id = o.id
  AND oi.organization_id IS NULL;
