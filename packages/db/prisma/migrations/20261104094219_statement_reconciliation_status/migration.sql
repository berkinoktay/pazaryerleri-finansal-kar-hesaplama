-- AlterTable
ALTER TABLE "order_profit_statements" ADD COLUMN     "reconciliation_status" "ReconciliationStatus" NOT NULL DEFAULT 'NOT_SETTLED';
