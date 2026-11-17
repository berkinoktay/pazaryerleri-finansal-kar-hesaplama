-- AlterTable
ALTER TABLE "plus_commission_tariff_items" ALTER COLUMN "current_price" DROP NOT NULL,
ALTER COLUMN "commission_base_price" DROP NOT NULL,
ALTER COLUMN "plus_price_upper_limit" DROP NOT NULL,
ALTER COLUMN "plus_commission_base_price" DROP NOT NULL;

-- Backfill: a price of 0 was never a real price. The import stored 0 (or copied a 0
-- through a fallback) for a blank or unreadable price cell, and a literal 0 in any of
-- the four price columns is no price either. Each becomes NULL (unknown), which the
-- screens show as such and never price at 0. updated_at is left alone: the tariff
-- itself did not change. plus_selected is left alone: an existing join with an
-- unknown ceiling can still be cleared by the seller, and the export refuses it
-- (409 SELECTION_PRICE_UNKNOWN) instead of writing 0.00.
UPDATE "plus_commission_tariff_items" SET "current_price" = NULL WHERE "current_price" = 0;
UPDATE "plus_commission_tariff_items" SET "commission_base_price" = NULL WHERE "commission_base_price" = 0;
UPDATE "plus_commission_tariff_items" SET "plus_price_upper_limit" = NULL WHERE "plus_price_upper_limit" = 0;
UPDATE "plus_commission_tariff_items" SET "plus_commission_base_price" = NULL WHERE "plus_commission_base_price" = 0;
-- Data only: a custom price of 0 was never a real price. The selection route now
-- refuses it (422 INVALID_CUSTOM_PRICE), but a value stored before could still reach
-- the export as 0.00. It becomes NULL (no custom price). updated_at is left alone: the
-- seller did not change anything.
UPDATE "plus_commission_tariff_items" SET "custom_price" = NULL WHERE "custom_price" = 0;
