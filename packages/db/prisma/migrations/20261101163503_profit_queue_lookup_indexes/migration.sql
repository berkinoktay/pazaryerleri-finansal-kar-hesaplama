-- DropIndex
DROP INDEX "profit_recompute_queue_next_attempt_at_idx";

-- CreateIndex
CREATE INDEX "order_claims_store_id_cargo_tracking_number_idx" ON "order_claims"("store_id", "cargo_tracking_number");

-- CreateIndex
CREATE INDEX "order_items_product_variant_id_idx" ON "order_items"("product_variant_id");

-- CreateIndex
CREATE INDEX "order_items_barcode_idx" ON "order_items"("barcode");

-- CreateIndex
CREATE INDEX "profit_recompute_queue_next_attempt_at_id_idx" ON "profit_recompute_queue"("next_attempt_at", "id");
