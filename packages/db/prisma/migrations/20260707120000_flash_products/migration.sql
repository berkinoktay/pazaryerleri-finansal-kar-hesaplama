-- Flash Products ("Flaş Ürünler") — two store-scoped tables (sibling of the
-- advantage_tariffs pair). The seller uploads Trendyol's "Flaş Ürünler" Excel;
-- offers arrive as ONE rolling list covering multiple dates (no periods): one
-- row = one product × one offer bundle. A row carries up to a 24-hour offer
-- (offer_24_*) and/or a 3-hour offer (offer_3_*); the seller joins one via
-- selected_offer (H24|H3) XOR sets a custom_price. Commission is NOT in this
-- Excel — compute resolves it per row from the store's covering commission_tariffs
-- band (by the window start), falling back to the flat current_commission_pct.
-- `source_file` keeps the raw .xlsx so export byte-patches Trendyol's exact file.
-- Profit is computed on read. RLS (store-scoped, can_access_store) is applied
-- separately via supabase/sql/rls-policies.sql. Written by hand (P3006 shadow-DB
-- issue). See docs/plans/2026-07-07-flash-products-design.md.

-- CreateEnum
CREATE TYPE "FlashOfferType" AS ENUM ('H24', 'H3');

-- CreateTable
CREATE TABLE "flash_product_lists" (
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

    CONSTRAINT "flash_product_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flash_product_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "list_id" UUID NOT NULL,
    "product_variant_id" UUID,
    "model_code" TEXT,
    "barcode" TEXT NOT NULL,
    "product_title" TEXT NOT NULL,
    "category" TEXT,
    "brand" TEXT,
    "stock" INTEGER,
    "external_id" TEXT,
    "current_price" DECIMAL(12,2) NOT NULL,
    "customer_price" DECIMAL(12,2) NOT NULL,
    "current_commission_pct" DECIMAL(6,4) NOT NULL,
    "has_commission_tariff" BOOLEAN NOT NULL,
    "campaigned_product" TEXT,
    "offer_24_price" DECIMAL(12,2),
    "offer_24_starts_at" TIMESTAMP(3),
    "offer_24_ends_at" TIMESTAMP(3),
    "offer_3_price" DECIMAL(12,2),
    "offer_3_starts_at" TIMESTAMP(3),
    "offer_3_ends_at" TIMESTAMP(3),
    "selected_offer" "FlashOfferType",
    "custom_price" DECIMAL(12,2),
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flash_product_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "flash_product_lists_organization_id_idx" ON "flash_product_lists"("organization_id");

-- CreateIndex
CREATE INDEX "flash_product_lists_store_id_idx" ON "flash_product_lists"("store_id");

-- CreateIndex
CREATE INDEX "flash_product_items_organization_id_idx" ON "flash_product_items"("organization_id");

-- CreateIndex
CREATE INDEX "flash_product_items_list_id_idx" ON "flash_product_items"("list_id");

-- CreateIndex
CREATE INDEX "flash_product_items_store_id_barcode_idx" ON "flash_product_items"("store_id", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "flash_product_items_list_id_sort_order_key" ON "flash_product_items"("list_id", "sort_order");

-- AddForeignKey
ALTER TABLE "flash_product_lists" ADD CONSTRAINT "flash_product_lists_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flash_product_items" ADD CONSTRAINT "flash_product_items_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "flash_product_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
