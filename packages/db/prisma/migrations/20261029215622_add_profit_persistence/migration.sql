-- CreateEnum
CREATE TYPE "ProfitStatementView" AS ENUM ('ESTIMATE', 'BEST_KNOWN');

-- CreateEnum
CREATE TYPE "ProfitAllocationBasis" AS ENUM ('STANDALONE_AMOUNT', 'EQUAL', 'SALE_SHARE');

-- CreateEnum
CREATE TYPE "FinanceRecordFamily" AS ENUM ('SETTLEMENT', 'OTHER_FINANCIAL', 'CARGO_INVOICE_ITEM');

-- CreateTable
CREATE TABLE "profit_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "order_item_id" UUID,
    "type" "ProfitLineType" NOT NULL,
    "level" "ProfitLineLevel" NOT NULL,
    "certainty" "ProfitLineCertainty" NOT NULL,
    "source" "ProfitLineSource" NOT NULL,
    "amount_gross" DECIMAL(14,2) NOT NULL,
    "amount_vat" DECIMAL(14,2) NOT NULL,
    "vat_rate_pct" DECIMAL(7,4),
    "original_currency" VARCHAR(3) NOT NULL,
    "original_gross" DECIMAL(14,2) NOT NULL,
    "original_vat" DECIMAL(14,2) NOT NULL,
    "fx_rate" DECIMAL(14,6) NOT NULL,
    "fx_rate_date" DATE,
    "fx_source" "FxRateSource" NOT NULL,
    "inputs" JSONB NOT NULL,
    "external_record_id" TEXT,
    "external_record_type" TEXT,
    "engine_version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profit_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profit_line_allocations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "profit_line_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "amount_gross" DECIMAL(14,2) NOT NULL,
    "amount_vat" DECIMAL(14,2) NOT NULL,
    "basis" "ProfitAllocationBasis" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profit_line_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_profit_statements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "view" "ProfitStatementView" NOT NULL,
    "status" "ProfitStatus" NOT NULL,
    "sale_gross" DECIMAL(14,2) NOT NULL,
    "cost_gross" DECIMAL(14,2) NOT NULL,
    "vat_output" DECIMAL(14,2) NOT NULL,
    "vat_input" DECIMAL(14,2) NOT NULL,
    "vat_net" DECIMAL(14,2) NOT NULL,
    "vat_effective" DECIMAL(14,2) NOT NULL,
    "stoppage_gross" DECIMAL(14,2) NOT NULL,
    "stoppage_included" BOOLEAN NOT NULL,
    "net_profit" DECIMAL(14,2),
    "sale_margin_pct" DECIMAL(12,4),
    "cost_markup_pct" DECIMAL(12,4),
    "issues" JSONB NOT NULL,
    "settings_snapshot" JSONB NOT NULL,
    "engine_version" INTEGER NOT NULL,
    "content_hash" TEXT NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_profit_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_finance_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "platform" "Platform" NOT NULL,
    "family" "FinanceRecordFamily" NOT NULL,
    "transaction_type" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "invoice_serial" TEXT,
    "order_number" TEXT,
    "shipment_package_id" TEXT,
    "barcode" TEXT,
    "payment_order_id" TEXT,
    "parcel_unique_id" TEXT,
    "transaction_date" TIMESTAMP(3),
    "debt" DECIMAL(14,2),
    "credit" DECIMAL(14,2),
    "commission_amount" DECIMAL(14,2),
    "amount_gross" DECIMAL(14,2),
    "desi" DECIMAL(8,2),
    "payload" JSONB NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_finance_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "profit_lines_order_id_idx" ON "profit_lines"("order_id");

-- CreateIndex
CREATE INDEX "profit_lines_order_item_id_idx" ON "profit_lines"("order_item_id");

-- CreateIndex
CREATE INDEX "profit_lines_organization_id_idx" ON "profit_lines"("organization_id");

-- CreateIndex
CREATE INDEX "profit_lines_store_id_type_idx" ON "profit_lines"("store_id", "type");

-- CreateIndex
CREATE INDEX "profit_line_allocations_profit_line_id_idx" ON "profit_line_allocations"("profit_line_id");

-- CreateIndex
CREATE INDEX "profit_line_allocations_order_item_id_idx" ON "profit_line_allocations"("order_item_id");

-- CreateIndex
CREATE INDEX "profit_line_allocations_organization_id_idx" ON "profit_line_allocations"("organization_id");

-- CreateIndex
CREATE INDEX "order_profit_statements_store_id_status_idx" ON "order_profit_statements"("store_id", "status");

-- CreateIndex
CREATE INDEX "order_profit_statements_organization_id_idx" ON "order_profit_statements"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_profit_statements_order_id_view_key" ON "order_profit_statements"("order_id", "view");

-- CreateIndex
CREATE INDEX "marketplace_finance_records_store_id_shipment_package_id_idx" ON "marketplace_finance_records"("store_id", "shipment_package_id");

-- CreateIndex
CREATE INDEX "marketplace_finance_records_store_id_order_number_idx" ON "marketplace_finance_records"("store_id", "order_number");

-- CreateIndex
CREATE INDEX "marketplace_finance_records_store_id_payment_order_id_idx" ON "marketplace_finance_records"("store_id", "payment_order_id");

-- CreateIndex
CREATE INDEX "marketplace_finance_records_store_id_parcel_unique_id_idx" ON "marketplace_finance_records"("store_id", "parcel_unique_id");

-- CreateIndex
CREATE INDEX "marketplace_finance_records_organization_id_idx" ON "marketplace_finance_records"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_finance_records_store_id_family_transaction_typ_key" ON "marketplace_finance_records"("store_id", "family", "transaction_type", "record_id");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "orders_store_id_order_date_idx" ON "orders"("store_id", "order_date");

-- AddForeignKey
ALTER TABLE "profit_lines" ADD CONSTRAINT "profit_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profit_lines" ADD CONSTRAINT "profit_lines_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profit_line_allocations" ADD CONSTRAINT "profit_line_allocations_profit_line_id_fkey" FOREIGN KEY ("profit_line_id") REFERENCES "profit_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profit_line_allocations" ADD CONSTRAINT "profit_line_allocations_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_profit_statements" ADD CONSTRAINT "order_profit_statements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_finance_records" ADD CONSTRAINT "marketplace_finance_records_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
