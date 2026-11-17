-- AlterTable
ALTER TABLE "commission_tariff_items" ALTER COLUMN "current_price" DROP NOT NULL;

-- Backfill: a price of 0 was never a real price. The import stored 0 for a blank or
-- unreadable GÜNCEL TSF cell, and a literal 0 in either price column is no price
-- either. Both become NULL (unknown), which the screens show as such and never price at
-- 0. updated_at is left alone: the tariff itself did not change.
UPDATE "commission_tariff_items" SET "current_price" = NULL WHERE "current_price" = 0;
UPDATE "commission_tariff_items" SET "commission_base_price" = NULL WHERE "commission_base_price" = 0;
