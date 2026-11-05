-- AlterTable
ALTER TABLE "marketplace_finance_records" ADD COLUMN     "bind_pending" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "marketplace_finance_records_store_id_bind_pending_idx" ON "marketplace_finance_records"("store_id", "bind_pending");
