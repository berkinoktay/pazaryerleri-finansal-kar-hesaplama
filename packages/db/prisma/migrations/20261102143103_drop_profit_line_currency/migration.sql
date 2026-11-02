-- AlterEnum
BEGIN;
CREATE TYPE "ProfitIssueCode_new" AS ENUM ('MISSING_COST', 'SHIPPING_ESTIMATE_UNAVAILABLE', 'UNMAPPED_MARKETPLACE_RECORD', 'MISSING_COMMISSION_RATE', 'AMBIGUOUS_RECORD_MATCH');
ALTER TYPE "ProfitIssueCode" RENAME TO "ProfitIssueCode_old";
ALTER TYPE "ProfitIssueCode_new" RENAME TO "ProfitIssueCode";
DROP TYPE "public"."ProfitIssueCode_old";
COMMIT;

-- AlterTable
ALTER TABLE "profit_lines" DROP COLUMN "fx_rate",
DROP COLUMN "fx_rate_date",
DROP COLUMN "fx_source",
DROP COLUMN "original_currency",
DROP COLUMN "original_gross",
DROP COLUMN "original_vat";

-- DropEnum
DROP TYPE "FxRateSource";
