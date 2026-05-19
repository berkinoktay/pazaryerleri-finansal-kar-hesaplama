-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('NOT_SETTLED', 'PARTIALLY_SETTLED', 'FULLY_SETTLED');

-- CreateEnum
CREATE TYPE "OrderFeeType" AS ENUM ('SHIPPING', 'PLATFORM_SERVICE', 'PLATFORM_SERVICE_FAST', 'STOPPAGE', 'RETURN_SHIPPING', 'REFUND_DEDUCTION', 'COMMISSION_REFUND', 'PROVISION_ADJUSTMENT', 'MANUAL_REFUND', 'REVENUE_ADJUSTMENT', 'COMMISSION_ADJUSTMENT', 'CUSTOM', 'ADVERTISING', 'PENALTY_DEFECTIVE', 'PENALTY_WRONG_PRODUCT', 'PENALTY_MISSING_PRODUCT', 'PENALTY_LATE_DELIVERY', 'PENALTY_SUPPLY_FAILURE', 'NOTIFICATION_FEE', 'COMMISSION_INVOICE');

-- CreateEnum
CREATE TYPE "OrderFeeSource" AS ENUM ('ESTIMATE', 'SETTLEMENT', 'CARGO_INVOICE', 'USER_OVERRIDE', 'MANUAL_ENTRY');

-- CreateEnum
CREATE TYPE "OrderFeeDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "FeeCalculationKind" AS ENUM ('FIXED', 'RATE_OF_SALE', 'FORMULA');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "actual_delivery_date" TIMESTAMP(3),
ADD COLUMN     "agreed_delivery_date" TIMESTAMP(3),
ADD COLUMN     "fast_delivery" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "micro" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "is_digital" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "fee_definitions" (
    "id" UUID NOT NULL,
    "platform" "Platform" NOT NULL,
    "fee_type" "OrderFeeType" NOT NULL,
    "display_name" TEXT NOT NULL,
    "calculation_kind" "FeeCalculationKind" NOT NULL,
    "fixed_amount_net" DECIMAL(12,2),
    "rate_of_sale" DECIMAL(7,4),
    "default_vat_rate" DECIMAL(5,2) NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_fees" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "fee_definition_id" UUID,
    "fee_type" "OrderFeeType" NOT NULL,
    "source" "OrderFeeSource" NOT NULL,
    "direction" "OrderFeeDirection" NOT NULL,
    "amount_net" DECIMAL(12,2) NOT NULL,
    "vat_rate" DECIMAL(5,2) NOT NULL,
    "vat_amount" DECIMAL(12,2) NOT NULL,
    "display_name" TEXT,
    "external_ref" JSONB,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),
    "confirmed_by" TEXT,

    CONSTRAINT "order_fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_claims" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "trendyol_claim_id" TEXT NOT NULL,
    "claim_date" TIMESTAMP(3) NOT NULL,
    "cargo_provider_name" TEXT,
    "cargo_tracking_number" BIGINT,
    "resolved" BOOLEAN NOT NULL,
    "external_ref" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_claim_items" (
    "id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "order_item_id" UUID,
    "trendyol_claim_item_id" TEXT NOT NULL,
    "reason_code" TEXT NOT NULL,
    "reason_name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "accepted_by_seller" BOOLEAN NOT NULL,
    "auto_approve_date" TIMESTAMP(3),
    "resolved" BOOLEAN NOT NULL,

    CONSTRAINT "order_claim_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_period_fees" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "payment_order_id" BIGINT NOT NULL,
    "payment_date" TIMESTAMP(3) NOT NULL,
    "fee_type" "OrderFeeType" NOT NULL,
    "source" "OrderFeeSource" NOT NULL,
    "amount_net" DECIMAL(12,2) NOT NULL,
    "vat_rate" DECIMAL(5,2) NOT NULL,
    "vat_amount" DECIMAL(12,2) NOT NULL,
    "invoice_serial_number" TEXT,
    "description" TEXT,
    "external_ref" JSONB,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_period_fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_invoices" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "trendyol_serial_number" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "total_net" DECIMAL(14,2) NOT NULL,
    "total_vat" DECIMAL(14,2) NOT NULL,
    "payment_order_id" BIGINT,
    "payment_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fee_definitions_platform_effective_from_idx" ON "fee_definitions"("platform", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "fee_definitions_platform_fee_type_effective_from_key" ON "fee_definitions"("platform", "fee_type", "effective_from");

-- CreateIndex
CREATE INDEX "order_fees_organization_id_fee_type_idx" ON "order_fees"("organization_id", "fee_type");

-- CreateIndex
CREATE INDEX "order_fees_order_id_fee_type_source_idx" ON "order_fees"("order_id", "fee_type", "source");

-- CreateIndex
CREATE INDEX "order_claims_organization_id_resolved_idx" ON "order_claims"("organization_id", "resolved");

-- CreateIndex
CREATE UNIQUE INDEX "order_claims_order_id_trendyol_claim_id_key" ON "order_claims"("order_id", "trendyol_claim_id");

-- CreateIndex
CREATE INDEX "order_claim_items_claim_id_idx" ON "order_claim_items"("claim_id");

-- CreateIndex
CREATE INDEX "order_claim_items_order_item_id_idx" ON "order_claim_items"("order_item_id");

-- CreateIndex
CREATE INDEX "org_period_fees_organization_id_payment_order_id_idx" ON "org_period_fees"("organization_id", "payment_order_id");

-- CreateIndex
CREATE INDEX "org_period_fees_organization_id_fee_type_payment_date_idx" ON "org_period_fees"("organization_id", "fee_type", "payment_date");

-- CreateIndex
CREATE INDEX "org_period_fees_store_id_payment_date_idx" ON "org_period_fees"("store_id", "payment_date");

-- CreateIndex
CREATE INDEX "commission_invoices_organization_id_period_start_idx" ON "commission_invoices"("organization_id", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "commission_invoices_store_id_trendyol_serial_number_key" ON "commission_invoices"("store_id", "trendyol_serial_number");

-- AddForeignKey
ALTER TABLE "order_fees" ADD CONSTRAINT "order_fees_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_fees" ADD CONSTRAINT "order_fees_fee_definition_id_fkey" FOREIGN KEY ("fee_definition_id") REFERENCES "fee_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_claims" ADD CONSTRAINT "order_claims_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_claim_items" ADD CONSTRAINT "order_claim_items_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "order_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_claim_items" ADD CONSTRAINT "order_claim_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_period_fees" ADD CONSTRAINT "org_period_fees_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_invoices" ADD CONSTRAINT "commission_invoices_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
