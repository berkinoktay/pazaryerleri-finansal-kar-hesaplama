-- Guard: the legacy import stored the raw upload file name, and a list name derived
-- from it, without a length limit, so a row may hold a longer value. This migration
-- never truncates: it stops here, before anything is written or altered, naming the
-- table and the two counts (never a value). Fix or shorten the reported rows, mark the
-- migration rolled back and deploy again.
DO $$
DECLARE
  _table text;
  _long_names bigint;
  _long_filenames bigint;
BEGIN
  FOREACH _table IN ARRAY ARRAY[
    'commission_tariffs',
    'plus_commission_tariffs',
    'advantage_tariffs',
    'flash_product_lists',
    'discount_lists',
    'marketplace_campaign_lists'
  ]
  LOOP
    EXECUTE format(
      'SELECT count(*) FILTER (WHERE char_length("name") > 120),
              count(*) FILTER (WHERE char_length("source_filename") > 120)
         FROM %I',
      _table
    ) INTO _long_names, _long_filenames;

    IF _long_names > 0 OR _long_filenames > 0 THEN
      RAISE EXCEPTION 'limit_workbook_names: % holds % name(s) and % source_filename(s) longer than 120 characters',
        _table, _long_names, _long_filenames;
    END IF;
  END LOOP;
END
$$;

-- Backfill again: the legacy import kept storing files without a format id between the
-- deploy of add_workbook_source_format and this one. Those rows get their page's v1 id,
-- as every file stored before the first migration did; a row that has an id keeps it.
-- updated_at is left alone: the list itself did not change.
UPDATE "commission_tariffs" SET "source_format_id" = 'TRENDYOL:COMMISSION_TARIFF:v1' WHERE "source_file" IS NOT NULL AND "source_format_id" IS NULL;
UPDATE "plus_commission_tariffs" SET "source_format_id" = 'TRENDYOL:PLUS_COMMISSION_TARIFF:v1' WHERE "source_file" IS NOT NULL AND "source_format_id" IS NULL;
UPDATE "advantage_tariffs" SET "source_format_id" = 'TRENDYOL:ADVANTAGE_TARIFF:v1' WHERE "source_file" IS NOT NULL AND "source_format_id" IS NULL;
UPDATE "flash_product_lists" SET "source_format_id" = 'TRENDYOL:FLASH_PRODUCT_LIST:v1' WHERE "source_file" IS NOT NULL AND "source_format_id" IS NULL;
UPDATE "discount_lists" SET "source_format_id" = 'TRENDYOL:DISCOUNT_LIST:v1' WHERE "source_file" IS NOT NULL AND "source_format_id" IS NULL;
UPDATE "marketplace_campaign_lists" SET "source_format_id" = 'TRENDYOL:MARKETPLACE_CAMPAIGN_LIST:v1' WHERE "source_file" IS NOT NULL AND "source_format_id" IS NULL;

-- The limit: TEXT to VARCHAR(120) rewrites each table, stored files included, under an
-- ACCESS EXCLUSIVE lock, so the deploy order stops the API and the worker first. One
-- ALTER TABLE per table changes both columns in a single rewrite.

-- AlterTable
ALTER TABLE "advantage_tariffs" ALTER COLUMN "name" SET DATA TYPE VARCHAR(120),
ALTER COLUMN "source_filename" SET DATA TYPE VARCHAR(120);

-- AlterTable
ALTER TABLE "commission_tariffs" ALTER COLUMN "name" SET DATA TYPE VARCHAR(120),
ALTER COLUMN "source_filename" SET DATA TYPE VARCHAR(120);

-- AlterTable
ALTER TABLE "discount_lists" ALTER COLUMN "name" SET DATA TYPE VARCHAR(120),
ALTER COLUMN "source_filename" SET DATA TYPE VARCHAR(120);

-- AlterTable
ALTER TABLE "flash_product_lists" ALTER COLUMN "name" SET DATA TYPE VARCHAR(120),
ALTER COLUMN "source_filename" SET DATA TYPE VARCHAR(120);

-- AlterTable
ALTER TABLE "marketplace_campaign_lists" ALTER COLUMN "name" SET DATA TYPE VARCHAR(120),
ALTER COLUMN "source_filename" SET DATA TYPE VARCHAR(120);

-- AlterTable
ALTER TABLE "plus_commission_tariffs" ALTER COLUMN "name" SET DATA TYPE VARCHAR(120),
ALTER COLUMN "source_filename" SET DATA TYPE VARCHAR(120);
