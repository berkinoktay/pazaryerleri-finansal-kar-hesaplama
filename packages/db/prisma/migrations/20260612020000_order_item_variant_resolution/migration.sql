-- Variant-resolution columns (hand-written; shadow replay broken — PR-8
-- precedent; SQL generated via `prisma migrate diff`).
-- Spec: docs/plans/2026-06-11-order-line-variant-recovery-design.md §5.
--
-- productVariantId NULL satırlar için deneme sayacı + backoff vadesi; worker'ın
-- variant-resolution tick'i yalnız vadesi gelmiş satırları tarar. Mevcut satırlar
-- attempts=0 + next_resolution_at NULL ile doğar → ilk tick'te hemen ele alınır.

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "next_resolution_at" TIMESTAMP(3),
ADD COLUMN     "variant_resolution_attempts" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "order_items_resolution_due_idx" ON "order_items"("next_resolution_at");
