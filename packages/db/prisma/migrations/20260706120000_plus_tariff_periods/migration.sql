-- Reshape Plus Commission Tariffs to the commission-tariff trio's three-level
-- model (tariff → period → item), reaching multi-period parity. Previously the
-- single 7-day period was folded onto the tariff and items hung straight off it;
-- now periods live in their own table and items hang off a period.
--
-- DESTRUCTIVE RESHAPE — dev-only data, re-import expected. The two old Plus
-- tables are dropped and recreated in their new shape (drop cascades the child
-- items). Plus tariffs are seller-uploaded Excels kept store-private for editing;
-- any existing dev rows are simply re-imported. RLS (store-scoped,
-- can_access_store) for plus_commission_tariff_periods is applied separately via
-- supabase/sql/rls-policies.sql (apply-policies / migrate deploy).

-- DropTable (child first, then parent — both recreated below)
DROP TABLE IF EXISTS "plus_commission_tariff_items";
DROP TABLE IF EXISTS "plus_commission_tariffs";

-- CreateTable
CREATE TABLE "plus_commission_tariffs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "source_filename" TEXT,
    "source_file" BYTEA,
    "week_starts_at" TIMESTAMP(3),
    "week_ends_at" TIMESTAMP(3),
    "exported_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plus_commission_tariffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plus_commission_tariff_periods" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "tariff_id" UUID NOT NULL,
    "date_range_label" TEXT NOT NULL,
    "day_count" INTEGER,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plus_commission_tariff_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plus_commission_tariff_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "product_variant_id" UUID,
    "barcode" TEXT NOT NULL,
    "stock_code" TEXT,
    "product_title" TEXT NOT NULL,
    "category" TEXT,
    "brand" TEXT,
    "size" TEXT,
    "model_code" TEXT,
    "stock" INTEGER,
    "current_price" DECIMAL(12,2) NOT NULL,
    "commission_base_price" DECIMAL(12,2) NOT NULL,
    "current_commission_pct" DECIMAL(6,4) NOT NULL,
    "plus_price_upper_limit" DECIMAL(12,2) NOT NULL,
    "plus_commission_pct" DECIMAL(6,4) NOT NULL,
    "plus_commission_base_price" DECIMAL(12,2) NOT NULL,
    "external_id" TEXT,
    "tariff_group" TEXT,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "plus_selected" BOOLEAN NOT NULL DEFAULT false,
    "custom_price" DECIMAL(12,2),
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plus_commission_tariff_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plus_commission_tariffs_organization_id_idx" ON "plus_commission_tariffs"("organization_id");

-- CreateIndex
CREATE INDEX "plus_commission_tariffs_store_id_idx" ON "plus_commission_tariffs"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "plus_commission_tariffs_store_id_week_starts_at_key" ON "plus_commission_tariffs"("store_id", "week_starts_at");

-- CreateIndex
CREATE INDEX "plus_commission_tariff_periods_organization_id_idx" ON "plus_commission_tariff_periods"("organization_id");

-- CreateIndex
CREATE INDEX "plus_commission_tariff_periods_tariff_id_idx" ON "plus_commission_tariff_periods"("tariff_id");

-- CreateIndex
CREATE UNIQUE INDEX "plus_commission_tariff_periods_tariff_id_sort_order_key" ON "plus_commission_tariff_periods"("tariff_id", "sort_order");

-- CreateIndex
CREATE INDEX "plus_commission_tariff_items_organization_id_idx" ON "plus_commission_tariff_items"("organization_id");

-- CreateIndex
CREATE INDEX "plus_commission_tariff_items_period_id_idx" ON "plus_commission_tariff_items"("period_id");

-- CreateIndex
CREATE INDEX "plus_commission_tariff_items_store_id_barcode_idx" ON "plus_commission_tariff_items"("store_id", "barcode");

-- AddForeignKey
ALTER TABLE "plus_commission_tariffs" ADD CONSTRAINT "plus_commission_tariffs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plus_commission_tariff_periods" ADD CONSTRAINT "plus_commission_tariff_periods_tariff_id_fkey" FOREIGN KEY ("tariff_id") REFERENCES "plus_commission_tariffs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plus_commission_tariff_items" ADD CONSTRAINT "plus_commission_tariff_items_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "plus_commission_tariff_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
