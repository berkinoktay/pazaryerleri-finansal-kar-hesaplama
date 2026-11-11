-- AlterTable
ALTER TABLE "cost_profile_versions" ADD COLUMN     "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing versions keep their old behavior: their effective date is the instant they were recorded.
UPDATE "cost_profile_versions" SET "effective_from" = "changed_at";
