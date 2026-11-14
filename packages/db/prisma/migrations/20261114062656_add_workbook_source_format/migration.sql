-- AlterTable
ALTER TABLE "advantage_tariffs" ADD COLUMN     "source_format_id" VARCHAR(64);

-- AlterTable
ALTER TABLE "commission_tariffs" ADD COLUMN     "source_format_id" VARCHAR(64);

-- AlterTable
ALTER TABLE "discount_lists" ADD COLUMN     "source_format_id" VARCHAR(64);

-- AlterTable
ALTER TABLE "flash_product_lists" ADD COLUMN     "source_format_id" VARCHAR(64);

-- AlterTable
ALTER TABLE "marketplace_campaign_lists" ADD COLUMN     "source_format_id" VARCHAR(64);

-- AlterTable
ALTER TABLE "plus_commission_tariffs" ADD COLUMN     "source_format_id" VARCHAR(64);

-- Backfill: every workbook stored before this migration was read by the Trendyol
-- resolver of its page, whatever the store's platform, so each stored file gets
-- that page's v1 format id. Rows without a stored file stay NULL. updated_at is
-- left alone: the list itself did not change.
UPDATE "commission_tariffs" SET "source_format_id" = 'TRENDYOL:COMMISSION_TARIFF:v1' WHERE "source_file" IS NOT NULL;
UPDATE "plus_commission_tariffs" SET "source_format_id" = 'TRENDYOL:PLUS_COMMISSION_TARIFF:v1' WHERE "source_file" IS NOT NULL;
UPDATE "advantage_tariffs" SET "source_format_id" = 'TRENDYOL:ADVANTAGE_TARIFF:v1' WHERE "source_file" IS NOT NULL;
UPDATE "flash_product_lists" SET "source_format_id" = 'TRENDYOL:FLASH_PRODUCT_LIST:v1' WHERE "source_file" IS NOT NULL;
UPDATE "discount_lists" SET "source_format_id" = 'TRENDYOL:DISCOUNT_LIST:v1' WHERE "source_file" IS NOT NULL;
UPDATE "marketplace_campaign_lists" SET "source_format_id" = 'TRENDYOL:MARKETPLACE_CAMPAIGN_LIST:v1' WHERE "source_file" IS NOT NULL;
