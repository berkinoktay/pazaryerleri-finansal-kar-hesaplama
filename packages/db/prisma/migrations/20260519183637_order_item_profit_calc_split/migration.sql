-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "commission_invoice_id" UUID,
ADD COLUMN     "commission_invoice_serial_number" TEXT,
ADD COLUMN     "gross_commission_amount_net" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "gross_commission_vat_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "refunded_commission_amount_net" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "refunded_commission_vat_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "seller_discount_net" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "seller_discount_vat_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "unit_cost_snapshot_net" DECIMAL(12,2),
ADD COLUMN     "unit_cost_snapshot_vat_amount" DECIMAL(12,2),
ADD COLUMN     "unit_cost_snapshot_vat_rate" DECIMAL(5,2),
ADD COLUMN     "unit_price_net" DECIMAL(12,2),
ADD COLUMN     "unit_vat_amount" DECIMAL(12,2),
ADD COLUMN     "unit_vat_rate" DECIMAL(5,2);

-- CreateIndex
CREATE INDEX "order_items_commission_invoice_id_idx" ON "order_items"("commission_invoice_id");

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_commission_invoice_id_fkey" FOREIGN KEY ("commission_invoice_id") REFERENCES "commission_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── CHECK constraint: refunded ≤ gross commission ─────────────────────
-- Mirrored to supabase/sql/check-constraints.sql for db:push workflow.
-- Effective commission = gross − refunded; > 0 hep tutarlı kalır (design §3.2).
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_refunded_commission_check"
  CHECK ("refunded_commission_amount_net" <= "gross_commission_amount_net");
