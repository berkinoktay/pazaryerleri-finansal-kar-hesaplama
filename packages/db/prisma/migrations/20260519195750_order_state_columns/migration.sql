-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "delivered_on_time" BOOLEAN,
ADD COLUMN     "estimated_net_profit" DECIMAL(12,2),
ADD COLUMN     "payment_date" TIMESTAMP(3),
ADD COLUMN     "payment_order_id" BIGINT,
ADD COLUMN     "platform_order_number" TEXT,
ADD COLUMN     "reconciliation_status" "ReconciliationStatus" NOT NULL DEFAULT 'NOT_SETTLED',
ADD COLUMN     "sale_subtotal_net" DECIMAL(12,2),
ADD COLUMN     "sale_vat_total" DECIMAL(12,2),
ADD COLUMN     "settled_net_profit" DECIMAL(12,2);

-- CreateIndex
CREATE INDEX "orders_organization_id_reconciliation_status_idx" ON "orders"("organization_id", "reconciliation_status");

-- CreateIndex
CREATE INDEX "orders_platform_order_number_idx" ON "orders"("platform_order_number");

-- CreateIndex
CREATE INDEX "orders_store_id_payment_order_id_idx" ON "orders"("store_id", "payment_order_id");
