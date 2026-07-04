-- 0-based Excel row order within the period, set at import from the file's row
-- sequence. The detail screen orders products by this so it matches the uploaded
-- file (and Trendyol's own screen), and stays identical across sub-period tabs
-- (the same product carries the same sort_order in every period). Existing rows
-- default to 0 (a re-import backfills the real order); a barcode tiebreak keeps
-- those all-zero legacy rows deterministic until then.

-- AlterTable
ALTER TABLE "commission_tariff_items" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;
