-- #298 OrderClaim store denormalization (hand-written; shadow replay broken —
-- PR-8 precedent).
--
-- OrderClaim tenant filtrelemesi `order: { storeId }` parent-walk'undan
-- doğrudan store_id kolonuna iner (diğer tüm store-scoped tablolarla aynı);
-- iade köprüsü (settlement Return → orijinal sipariş) JSONB
-- external_ref->>'orderShipmentPackageId' eşitliği yerine indexli kolon
-- kullanır. RLS policy'si aynı PR'da can_access_store(store_id)'ye sadeleşir
-- (rls-policies.sql — apply-policies bu migration'dan sonra koşar).

-- AlterTable: kolonlar önce nullable gelir (backfill sonrası store_id NOT NULL)
ALTER TABLE "order_claims" ADD COLUMN "store_id" UUID,
ADD COLUMN "order_shipment_package_id" TEXT,
ADD COLUMN "order_outbound_package_id" TEXT;

-- Backfill: store_id parent order'dan tek UPDATE-join; paket id'leri
-- external_ref audit anahtarlarından (JSON null → ->> zaten SQL NULL verir).
UPDATE "order_claims"
SET "store_id" = o."store_id"
FROM "orders" o
WHERE o."id" = "order_claims"."order_id";

UPDATE "order_claims"
SET "order_shipment_package_id" = "external_ref"->>'orderShipmentPackageId',
    "order_outbound_package_id"  = "external_ref"->>'orderOutboundPackageId'
WHERE "external_ref" IS NOT NULL;

-- store_id artık zorunlu + FK (orders.store_id'den geldiği için her satırda dolu)
ALTER TABLE "order_claims" ALTER COLUMN "store_id" SET NOT NULL;
ALTER TABLE "order_claims" ADD CONSTRAINT "order_claims_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex: köprü lookup'ı (storeId + iade kolisi id) + store-scoped worklist
CREATE INDEX "order_claims_store_id_order_shipment_package_id_idx"
  ON "order_claims"("store_id", "order_shipment_package_id");
CREATE INDEX "order_claims_store_id_resolved_idx"
  ON "order_claims"("store_id", "resolved");
