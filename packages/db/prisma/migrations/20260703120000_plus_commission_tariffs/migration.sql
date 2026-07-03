-- Saved Plus Commission Tariffs — two store-scoped tables (sibling of the
-- commission_tariffs trio, but simpler: single 7-day period folded onto the
-- tariff, single reduced Plus offer per product instead of a 4-band ladder).
--
-- The seller uploads Trendyol's "Plus Komisyon" Excel; we keep it store-private
-- and editable. Each item holds flat current-vs-Plus columns; profit under Plus
-- is computed on read. `source_file` keeps the raw .xlsx so export can patch the
-- seller's opt-in back into Trendyol's exact file. RLS (store-scoped,
-- can_access_store) is applied separately via supabase/sql/rls-policies.sql.

-- CreateTable
CREATE TABLE "plus_commission_tariffs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "source_filename" TEXT,
    "source_file" BYTEA,
    "date_range_label" TEXT NOT NULL,
    "day_count" INTEGER,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "exported_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plus_commission_tariffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plus_commission_tariff_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "tariff_id" UUID NOT NULL,
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
CREATE INDEX "plus_commission_tariff_items_organization_id_idx" ON "plus_commission_tariff_items"("organization_id");

-- CreateIndex
CREATE INDEX "plus_commission_tariff_items_tariff_id_idx" ON "plus_commission_tariff_items"("tariff_id");

-- CreateIndex
CREATE INDEX "plus_commission_tariff_items_store_id_barcode_idx" ON "plus_commission_tariff_items"("store_id", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "plus_commission_tariff_items_tariff_id_sort_order_key" ON "plus_commission_tariff_items"("tariff_id", "sort_order");

-- AddForeignKey
ALTER TABLE "plus_commission_tariffs" ADD CONSTRAINT "plus_commission_tariffs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plus_commission_tariff_items" ADD CONSTRAINT "plus_commission_tariff_items_tariff_id_fkey" FOREIGN KEY ("tariff_id") REFERENCES "plus_commission_tariffs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
