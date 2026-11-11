-- CreateEnum
CREATE TYPE "ProfitRecomputeReason" AS ENUM ('ORDER_CHANGED', 'CLAIM_CHANGED', 'FINANCE_RECORD', 'COST_CHANGED', 'SETTINGS_CHANGED', 'REFERENCE_CHANGED', 'STALE_STATEMENT', 'MANUAL');

-- DropIndex
DROP INDEX "marketplace_finance_records_store_id_family_transaction_typ_key";

-- AlterTable
ALTER TABLE "marketplace_finance_records" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "order_commission_rate_pct" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "profit_recompute_queue" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "reason" "ProfitRecomputeReason" NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profit_recompute_queue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "profit_recompute_queue_order_id_key" ON "profit_recompute_queue"("order_id");

-- CreateIndex
CREATE INDEX "profit_recompute_queue_next_attempt_at_idx" ON "profit_recompute_queue"("next_attempt_at");

-- CreateIndex
CREATE INDEX "profit_recompute_queue_store_id_idx" ON "profit_recompute_queue"("store_id");

-- CreateIndex
CREATE INDEX "profit_recompute_queue_organization_id_idx" ON "profit_recompute_queue"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_finance_records_store_id_family_record_id_key" ON "marketplace_finance_records"("store_id", "family", "record_id");

-- AddForeignKey
ALTER TABLE "profit_recompute_queue" ADD CONSTRAINT "profit_recompute_queue_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
