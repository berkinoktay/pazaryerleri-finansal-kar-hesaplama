-- Phase 5 of the profit-engine rebuild (docs/plans/2026-10-29-profit-engine-design.md
-- section 11): the legacy fee, settlement and commission-invoice storage and the
-- denormalized profit, commission and cost-snapshot columns are dropped. Every
-- profit figure now lives in profit_lines / order_profit_statements, every raw
-- marketplace record in marketplace_finance_records.

-- The cost-snapshot write-once trigger references three columns dropped below; it
-- must go first or every UPDATE on order_items would fail at runtime. The function
-- and trigger were created by supabase/sql/triggers.sql, never by a migration.
DROP TRIGGER IF EXISTS order_items_snapshot_immutable ON order_items;
DROP FUNCTION IF EXISTS public.reject_snapshot_update();

-- Objects that only supabase/sql/check-constraints.sql created (never a migration),
-- dropped explicitly so a database that applied the policies matches one that did
-- not. The partial indexes would fall with their tables anyway; the CHECK
-- constraint would fall with its columns.
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_refunded_commission_check;
DROP INDEX IF EXISTS order_fees_settlement_leg_uniq;
DROP INDEX IF EXISTS order_fees_cargo_invoice_line_uniq;
DROP INDEX IF EXISTS order_fees_derived_correction_uniq;
DROP INDEX IF EXISTS order_fees_estimate_fee_type_uniq;
DROP INDEX IF EXISTS org_period_fees_settlement_row_uniq;

-- DropForeignKey
ALTER TABLE "commission_invoices" DROP CONSTRAINT "commission_invoices_store_id_fkey";

-- DropForeignKey
ALTER TABLE "order_fees" DROP CONSTRAINT "order_fees_fee_definition_id_fkey";

-- DropForeignKey
ALTER TABLE "order_fees" DROP CONSTRAINT "order_fees_order_claim_item_id_fkey";

-- DropForeignKey
ALTER TABLE "order_fees" DROP CONSTRAINT "order_fees_order_id_fkey";

-- DropForeignKey
ALTER TABLE "order_items" DROP CONSTRAINT "order_items_commission_invoice_id_fkey";

-- DropForeignKey
ALTER TABLE "org_period_fees" DROP CONSTRAINT "org_period_fees_store_id_fkey";

-- DropForeignKey
ALTER TABLE "settlement_items" DROP CONSTRAINT "settlement_items_settlement_id_fkey";

-- DropForeignKey
ALTER TABLE "settlements" DROP CONSTRAINT "settlements_store_id_fkey";

-- DropIndex
DROP INDEX "order_items_commission_invoice_id_idx";

-- DropIndex
DROP INDEX "order_items_organization_id_snapshot_captured_at_idx";

-- DropIndex
DROP INDEX "orders_organization_id_reconciliation_status_idx";

-- DropIndex
DROP INDEX "orders_store_id_payment_order_id_idx";

-- AlterTable
ALTER TABLE "order_items" DROP COLUMN "commission_gross",
DROP COLUMN "commission_invoice_id",
DROP COLUMN "commission_invoice_serial_number",
DROP COLUMN "commission_rate",
DROP COLUMN "commission_vat_rate",
DROP COLUMN "estimated_commission_gross",
DROP COLUMN "refunded_commission_gross",
DROP COLUMN "settled_commission_gross",
DROP COLUMN "settled_sale_amount",
DROP COLUMN "snapshot_captured_at",
DROP COLUMN "unit_cost_snapshot_gross",
DROP COLUMN "unit_cost_snapshot_vat_rate";

-- AlterTable
ALTER TABLE "orders" DROP COLUMN "estimated_cost_markup_pct",
DROP COLUMN "estimated_net_profit",
DROP COLUMN "estimated_net_vat",
DROP COLUMN "estimated_sale_margin_pct",
DROP COLUMN "payment_date",
DROP COLUMN "payment_order_id",
DROP COLUMN "reconciliation_status",
DROP COLUMN "settled_cost_markup_pct",
DROP COLUMN "settled_net_profit",
DROP COLUMN "settled_net_vat",
DROP COLUMN "settled_sale_margin_pct";

-- DropTable
DROP TABLE "commission_invoices";

-- DropTable
DROP TABLE "order_fees";

-- DropTable
DROP TABLE "org_period_fees";

-- DropTable
DROP TABLE "settlement_items";

-- DropTable
DROP TABLE "settlements";

-- DropEnum
DROP TYPE "OrderFeeDirection";

-- DropEnum
DROP TYPE "OrderFeeSource";

-- DropEnum
DROP TYPE "SettlementItemType";

-- DropEnum
DROP TYPE "SettlementStatus";
