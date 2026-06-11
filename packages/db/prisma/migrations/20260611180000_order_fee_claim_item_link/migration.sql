-- #299 OrderFee → OrderClaimItem link (hand-written; shadow replay broken —
-- PR-8 precedent; SQL generated via `prisma migrate diff`).
--
-- Her settlement Return bacağı (REFUND_DEDUCTION / COMMISSION_REFUND /
-- COST_RETURN) ait olduğu iade BİRİMİNE bağlanır — Trendyol birim başına bir
-- claimItem üretir, kısmi iadede kalem-düzeyi finansal atıf buradan okunur.
-- Nullable: settlements cron'u (:30) claims cron'undan (:45) önce koştuğu için
-- üçlü çoğu zaman claim satırından ÖNCE yazılır; return.ts'teki koşulsuz
-- backfill sonraki re-poll'da bağı doldurur. UI gösterimi V2 (spec §4).

-- AlterTable
ALTER TABLE "order_fees" ADD COLUMN     "order_claim_item_id" UUID;

-- CreateIndex
CREATE INDEX "order_fees_order_claim_item_id_idx" ON "order_fees"("order_claim_item_id");

-- AddForeignKey
ALTER TABLE "order_fees" ADD CONSTRAINT "order_fees_order_claim_item_id_fkey" FOREIGN KEY ("order_claim_item_id") REFERENCES "order_claim_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
