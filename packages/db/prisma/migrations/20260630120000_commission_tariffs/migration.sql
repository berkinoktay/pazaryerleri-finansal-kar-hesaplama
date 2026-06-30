-- Saved Commission Tariffs (campaign price-band tariff) — three store-scoped tables.
--
-- The seller uploads Trendyol's "Ürün Komisyon Tarifeleri" Excel; we keep it as a
-- store-private, editable tariff. A tariff has one or more periods (the date-range
-- split, data-driven — 1/2/… periods) and each period has product rows. Each row
-- carries its price bands (range + commission) as JSON; profit is computed on read.
-- `source_file` keeps the raw .xlsx so export can patch the seller's choices back
-- into Trendyol's exact file. RLS (store-scoped, can_access_store) is applied
-- separately via supabase/sql/rls-policies.sql (apply-policies / migrate deploy).

-- CreateTable
CREATE TABLE "commission_tariffs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "source_filename" TEXT,
    "source_file" BYTEA,
    "exported_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_tariffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_tariff_periods" (
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

    CONSTRAINT "commission_tariff_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_tariff_items" (
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
    "stock" INTEGER,
    "current_price" DECIMAL(12,2) NOT NULL,
    "current_commission_pct" DECIMAL(6,4) NOT NULL,
    "bands" JSONB NOT NULL,
    "selected_band" TEXT,
    "custom_price" DECIMAL(12,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_tariff_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commission_tariffs_organization_id_idx" ON "commission_tariffs"("organization_id");

-- CreateIndex
CREATE INDEX "commission_tariffs_store_id_idx" ON "commission_tariffs"("store_id");

-- CreateIndex
CREATE INDEX "commission_tariff_periods_organization_id_idx" ON "commission_tariff_periods"("organization_id");

-- CreateIndex
CREATE INDEX "commission_tariff_periods_tariff_id_idx" ON "commission_tariff_periods"("tariff_id");

-- CreateIndex
CREATE UNIQUE INDEX "commission_tariff_periods_tariff_id_sort_order_key" ON "commission_tariff_periods"("tariff_id", "sort_order");

-- CreateIndex
CREATE INDEX "commission_tariff_items_organization_id_idx" ON "commission_tariff_items"("organization_id");

-- CreateIndex
CREATE INDEX "commission_tariff_items_period_id_idx" ON "commission_tariff_items"("period_id");

-- CreateIndex
CREATE INDEX "commission_tariff_items_store_id_barcode_idx" ON "commission_tariff_items"("store_id", "barcode");

-- AddForeignKey
ALTER TABLE "commission_tariffs" ADD CONSTRAINT "commission_tariffs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_tariff_periods" ADD CONSTRAINT "commission_tariff_periods_tariff_id_fkey" FOREIGN KEY ("tariff_id") REFERENCES "commission_tariffs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_tariff_items" ADD CONSTRAINT "commission_tariff_items_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "commission_tariff_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

