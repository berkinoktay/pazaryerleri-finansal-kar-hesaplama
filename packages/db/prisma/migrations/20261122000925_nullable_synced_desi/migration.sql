-- AlterTable
ALTER TABLE "product_variants" ALTER COLUMN "synced_dimensional_weight" DROP NOT NULL;

-- Data: the mapper used to store 0 both when Trendyol sent no desi and when it
-- sent a literal 0, so an existing synced 0 cannot be told apart. Empty them all:
-- from now on null means "the marketplace sent no desi" and 0 is a real desi. The
-- next full product sync writes back every 0 Trendyol really sends.
UPDATE "product_variants" SET "synced_dimensional_weight" = NULL WHERE "synced_dimensional_weight" = 0;
