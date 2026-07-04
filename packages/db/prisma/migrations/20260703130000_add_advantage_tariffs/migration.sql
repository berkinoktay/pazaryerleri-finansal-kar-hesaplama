-- Advantage Product Labels ("Avantajlı/Yıldızlı Ürün Etiketleri") — two
-- store-scoped tables (sibling of the plus_commission_tariffs pair). The seller
-- uploads Trendyol's "Advantage Product Labels" Excel; each item holds the three
-- star tiers (as JSON) + the current price. UNLIKE the other tariff verticals the
-- reduced commission is NOT in this Excel — compute READS the store's
-- active-period commission_tariffs bands (or the pinned commission_source_tariff_id)
-- and falls back to the category rate. Profit is computed on read. `source_file`
-- keeps the raw .xlsx so export byte-patches Trendyol's exact file. RLS
-- (store-scoped, can_access_store) is applied separately via
-- supabase/sql/rls-policies.sql. See docs/plans/2026-07-03-advantage-labels-design.md.

-- CreateTable
CREATE TABLE "advantage_tariffs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "source_filename" TEXT,
    "source_file" BYTEA,
    "commission_source_tariff_id" UUID,
    "exported_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "advantage_tariffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advantage_tariff_items" (
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
    "customer_price" DECIMAL(12,2) NOT NULL,
    "has_commission_tariff" BOOLEAN NOT NULL,
    "star_tiers" JSONB NOT NULL,
    "apply_until_end" BOOLEAN NOT NULL,
    "external_id" TEXT,
    "tariff_group" TEXT,
    "selected_tier" TEXT,
    "custom_price" DECIMAL(12,2),
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "advantage_tariff_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "advantage_tariffs_organization_id_idx" ON "advantage_tariffs"("organization_id");

-- CreateIndex
CREATE INDEX "advantage_tariffs_store_id_idx" ON "advantage_tariffs"("store_id");

-- CreateIndex
CREATE INDEX "advantage_tariffs_commission_source_tariff_id_idx" ON "advantage_tariffs"("commission_source_tariff_id");

-- CreateIndex
CREATE INDEX "advantage_tariff_items_organization_id_idx" ON "advantage_tariff_items"("organization_id");

-- CreateIndex
CREATE INDEX "advantage_tariff_items_tariff_id_idx" ON "advantage_tariff_items"("tariff_id");

-- CreateIndex
CREATE INDEX "advantage_tariff_items_store_id_barcode_idx" ON "advantage_tariff_items"("store_id", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "advantage_tariff_items_tariff_id_sort_order_key" ON "advantage_tariff_items"("tariff_id", "sort_order");

-- AddForeignKey
ALTER TABLE "advantage_tariffs" ADD CONSTRAINT "advantage_tariffs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advantage_tariffs" ADD CONSTRAINT "advantage_tariffs_commission_source_tariff_id_fkey" FOREIGN KEY ("commission_source_tariff_id") REFERENCES "commission_tariffs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advantage_tariff_items" ADD CONSTRAINT "advantage_tariff_items_tariff_id_fkey" FOREIGN KEY ("tariff_id") REFERENCES "advantage_tariffs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
