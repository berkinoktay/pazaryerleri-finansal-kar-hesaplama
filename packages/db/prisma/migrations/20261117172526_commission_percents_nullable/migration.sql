-- A blank or unreadable commission percent cell in a campaign workbook is unknown and
-- is now stored as NULL (the screens show it as such and never price anything at 0%);
-- a readable 0 stays a real 0% commission.
-- NO backfill: a stored 0 cannot be told apart from a genuine 0% commission, so
-- existing rows keep their value. Re-uploading the file fixes an old tariff.

-- AlterTable
ALTER TABLE "commission_tariff_items" ALTER COLUMN "current_commission_pct" DROP NOT NULL;

-- AlterTable
ALTER TABLE "flash_product_items" ALTER COLUMN "current_commission_pct" DROP NOT NULL;

-- AlterTable
ALTER TABLE "plus_commission_tariff_items" ALTER COLUMN "current_commission_pct" DROP NOT NULL,
ALTER COLUMN "plus_commission_pct" DROP NOT NULL;
