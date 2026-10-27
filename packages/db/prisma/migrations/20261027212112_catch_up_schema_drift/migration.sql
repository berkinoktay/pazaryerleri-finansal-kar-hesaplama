-- CreateEnum
CREATE TYPE "SyncTriggerSource" AS ENUM ('MANUAL', 'CRON', 'BOOTSTRAP');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('NET', 'CONDITIONAL_BASKET', 'CONDITIONAL_QUANTITY', 'BUY_X_PAY_Y', 'NTH_PRODUCT', 'CODE');

-- CreateEnum
CREATE TYPE "DiscountValueKind" AS ENUM ('AMOUNT', 'PERCENT', 'FIXED_PRICE');

-- CreateEnum
CREATE TYPE "CampaignPriceSelection" AS ENUM ('NONE', 'MAX', 'CUSTOM');

-- AlterEnum
ALTER TYPE "SyncType" ADD VALUE 'PRODUCTS_DELTA';

-- DropForeignKey
ALTER TABLE "order_item_cost_snapshot_components" DROP CONSTRAINT "order_item_cost_snapshot_components_profile_id_fkey";

-- DropForeignKey
ALTER TABLE "product_variant_cost_profiles" DROP CONSTRAINT "product_variant_cost_profiles_profile_id_fkey";

-- DropIndex
DROP INDEX "cost_profiles_organization_id_archived_at_idx";

-- DropIndex
DROP INDEX "cost_profiles_organization_id_name_key";

-- DropIndex
DROP INDEX "cost_profiles_organization_id_type_idx";

-- DropIndex
DROP INDEX "expenses_organization_id_idx";

-- AlterTable
ALTER TABLE "cost_profiles" ADD COLUMN     "store_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "delisted_at" TIMESTAMP(3),
ADD COLUMN     "synced_commission_rate" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "sync_logs" ADD COLUMN     "trigger_source" "SyncTriggerSource" NOT NULL DEFAULT 'CRON';

-- AlterTable
ALTER TABLE "webhook_events" ADD COLUMN     "next_process_at" TIMESTAMP(3),
ADD COLUMN     "process_attempts" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "discount_lists" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "discount_type" "DiscountType" NOT NULL,
    "value_kind" "DiscountValueKind",
    "value" DECIMAL(12,2),
    "min_basket_amount" DECIMAL(12,2),
    "min_quantity" INTEGER,
    "buy_quantity" INTEGER,
    "pay_quantity" INTEGER,
    "nth_index" INTEGER,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "source_filename" TEXT,
    "source_file" BYTEA,
    "exported_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discount_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_list_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "list_id" UUID NOT NULL,
    "product_variant_id" UUID,
    "external_id" TEXT,
    "product_title" TEXT NOT NULL,
    "brand" TEXT,
    "color" TEXT,
    "barcode" TEXT NOT NULL,
    "model_code" TEXT,
    "current_price" DECIMAL(12,2) NOT NULL,
    "included" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discount_list_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_campaign_lists" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "discount_type" "DiscountType" NOT NULL,
    "value_kind" "DiscountValueKind",
    "value" DECIMAL(12,2),
    "min_basket_amount" DECIMAL(12,2),
    "min_quantity" INTEGER,
    "buy_quantity" INTEGER,
    "pay_quantity" INTEGER,
    "nth_index" INTEGER,
    "trendyol_funding_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "source_filename" TEXT,
    "source_file" BYTEA,
    "exported_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_campaign_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_campaign_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "list_id" UUID NOT NULL,
    "product_variant_id" UUID,
    "barcode" TEXT NOT NULL,
    "product_title" TEXT NOT NULL,
    "product_code" TEXT,
    "category" TEXT,
    "brand" TEXT,
    "color" TEXT,
    "size" TEXT,
    "stock_code" TEXT,
    "stock" INTEGER,
    "external_id" TEXT,
    "current_price" DECIMAL(12,2) NOT NULL,
    "max_price" DECIMAL(12,2) NOT NULL,
    "has_commission_tariff" BOOLEAN NOT NULL DEFAULT false,
    "selection" "CampaignPriceSelection" NOT NULL DEFAULT 'NONE',
    "custom_price" DECIMAL(12,2),
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_campaign_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "discount_lists_organization_id_idx" ON "discount_lists"("organization_id");

-- CreateIndex
CREATE INDEX "discount_lists_store_id_idx" ON "discount_lists"("store_id");

-- CreateIndex
CREATE INDEX "discount_list_items_organization_id_idx" ON "discount_list_items"("organization_id");

-- CreateIndex
CREATE INDEX "discount_list_items_list_id_idx" ON "discount_list_items"("list_id");

-- CreateIndex
CREATE INDEX "discount_list_items_store_id_barcode_idx" ON "discount_list_items"("store_id", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "discount_list_items_list_id_sort_order_key" ON "discount_list_items"("list_id", "sort_order");

-- CreateIndex
CREATE INDEX "marketplace_campaign_lists_organization_id_idx" ON "marketplace_campaign_lists"("organization_id");

-- CreateIndex
CREATE INDEX "marketplace_campaign_lists_store_id_idx" ON "marketplace_campaign_lists"("store_id");

-- CreateIndex
CREATE INDEX "marketplace_campaign_items_organization_id_idx" ON "marketplace_campaign_items"("organization_id");

-- CreateIndex
CREATE INDEX "marketplace_campaign_items_list_id_idx" ON "marketplace_campaign_items"("list_id");

-- CreateIndex
CREATE INDEX "marketplace_campaign_items_store_id_barcode_idx" ON "marketplace_campaign_items"("store_id", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_campaign_items_list_id_sort_order_key" ON "marketplace_campaign_items"("list_id", "sort_order");

-- CreateIndex
CREATE INDEX "cost_profiles_store_id_archived_at_idx" ON "cost_profiles"("store_id", "archived_at");

-- CreateIndex
CREATE INDEX "cost_profiles_store_id_type_idx" ON "cost_profiles"("store_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "cost_profiles_store_id_name_key" ON "cost_profiles"("store_id", "name");

-- CreateIndex
CREATE INDEX "expenses_organization_id_store_id_idx" ON "expenses"("organization_id", "store_id");

-- CreateIndex
CREATE INDEX "product_variants_store_id_delisted_at_idx" ON "product_variants"("store_id", "delisted_at");

-- AddForeignKey
ALTER TABLE "cost_profiles" ADD CONSTRAINT "cost_profiles_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variant_cost_profiles" ADD CONSTRAINT "product_variant_cost_profiles_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "cost_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_cost_snapshot_components" ADD CONSTRAINT "order_item_cost_snapshot_components_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "cost_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_lists" ADD CONSTRAINT "discount_lists_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_list_items" ADD CONSTRAINT "discount_list_items_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "discount_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_campaign_lists" ADD CONSTRAINT "marketplace_campaign_lists_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_campaign_items" ADD CONSTRAINT "marketplace_campaign_items_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "marketplace_campaign_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
