-- CreateIndex
CREATE INDEX "marketplace_finance_records_prune_idx" ON "marketplace_finance_records"("store_id", "family", "transaction_type", "transaction_date");
