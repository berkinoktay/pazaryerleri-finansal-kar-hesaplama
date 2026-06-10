-- PR-13 claims sync foundation (hand-written; shadow replay broken — PR-8 precedent)

-- AlterEnum: new sync queue type for the GetClaims worker
ALTER TYPE "SyncType" ADD VALUE 'CLAIMS';

-- AlterTable: hygiene timestamps on order_claim_items (created_at/updated_at
-- are mandatory on all tables; this table predates the rule's enforcement).
-- updated_at gets a backfill default for existing rows, then drops it —
-- Prisma's @updatedAt owns the value at the application layer.
ALTER TABLE "order_claim_items" ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "order_claim_items" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "order_claim_items" ALTER COLUMN "updated_at" DROP DEFAULT;

-- Idempotency anchor for the CLAIMS sync upsert: Trendyol's claimLineItem id
-- is unique per unit within a claim. The unique index covers the old
-- claim_id lookup index, which is dropped.
DROP INDEX "order_claim_items_claim_id_idx";
CREATE UNIQUE INDEX "order_claim_items_claim_id_trendyol_claim_item_id_key" ON "order_claim_items"("claim_id", "trendyol_claim_item_id");
