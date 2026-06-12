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

-- CreateIndex — PARTIAL: kuyruk sorgusu yalnız çözülmemiş satırları tarar;
-- düz (full-table) index OR'lu vade filtresine hizmet edemezdi. Prisma kısmi
-- index yazamaz → check-constraints.sql aynası (apply-policies dev yolu).
CREATE INDEX IF NOT EXISTS "order_items_resolution_due_idx"
  ON "order_items"("next_resolution_at")
  WHERE "product_variant_id" IS NULL AND "barcode" IS NOT NULL;

-- ESTIMATE fee idempotency — T+0 PSF/Stopaj sipariş başına TEK'tir; geç
-- maliyet re-entry'si (Slice C manuel giriş, variant-resolution tick) veya
-- yarışan iki tx çift yazamasın (#297 guard'ları ESTIMATE'i bilinçli dışarıda
-- bırakmıştı — kimlik kolonu yoktu; anahtar (order_id, fee_type)).
-- Mirror: supabase/sql/check-constraints.sql.
--
-- Önce olası mevcut çiftler temizlenir: paylaşılan re-entry defekti (Slice C
-- manuel maliyet girişi de applyEstimateOnOrderCreate'i yeniden çağırır) çift
-- PSF/Stopaj yazmış olabilir. En eski satır kalır; çiftten etkilenen
-- siparişlerin write-once kilitlenmiş estimated_net_profit'i YANLIŞ (2x fee)
-- hesaplanmıştı → NULL'a çekilir ki sonraki re-entry doğru değeri yazsın.
WITH doomed AS (
  SELECT id, order_id
  FROM (
    SELECT id, order_id,
           row_number() OVER (
             PARTITION BY order_id, fee_type
             ORDER BY captured_at, id
           ) AS rn
    FROM order_fees
    WHERE source = 'ESTIMATE'
  ) ranked
  WHERE rn > 1
),
reset_orders AS (
  UPDATE orders SET estimated_net_profit = NULL
  WHERE id IN (SELECT DISTINCT order_id FROM doomed)
)
DELETE FROM order_fees WHERE id IN (SELECT id FROM doomed);

CREATE UNIQUE INDEX IF NOT EXISTS "order_fees_estimate_fee_type_uniq"
  ON "order_fees" ("order_id", "fee_type")
  WHERE "source" = 'ESTIMATE';
