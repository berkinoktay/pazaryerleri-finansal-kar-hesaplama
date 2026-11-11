-- Phase 5 of the profit-engine rebuild (design section 11): the shared order and claim
-- tables carry marketplace-neutral column names. Hand-written RENAMEs keep the data;
-- Prisma would have generated DROP + ADD.
ALTER TABLE "orders" RENAME COLUMN "micro" TO "is_export_sale";
ALTER TABLE "order_claims" RENAME COLUMN "trendyol_claim_id" TO "marketplace_claim_id";
ALTER INDEX "order_claims_order_id_trendyol_claim_id_key" RENAME TO "order_claims_order_id_marketplace_claim_id_key";
ALTER TABLE "order_claim_items" RENAME COLUMN "trendyol_claim_item_id" TO "marketplace_claim_item_id";
ALTER INDEX "order_claim_items_claim_id_trendyol_claim_item_id_key" RENAME TO "order_claim_items_claim_id_marketplace_claim_item_id_key";
-- order_items lost its only organization_id-leading index with the cost-snapshot
-- columns; every tenant table carries one (docs/SECURITY.md).
CREATE INDEX "order_items_organization_id_idx" ON "order_items"("organization_id");
