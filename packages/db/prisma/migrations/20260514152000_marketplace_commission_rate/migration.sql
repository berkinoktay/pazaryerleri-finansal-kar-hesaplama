-- CreateEnum
CREATE TYPE "CommissionRuleKind" AS ENUM ('CATEGORY', 'CATEGORY_BRAND');

-- CreateTable
CREATE TABLE "marketplace_commission_rate" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "platform" "Platform" NOT NULL,
    "rule_kind" "CommissionRuleKind" NOT NULL,
    "category_id" BIGINT NOT NULL,
    "brand_id" BIGINT,
    "category_name" TEXT NOT NULL,
    "parent_category_name" TEXT,
    "brand_name" TEXT,
    "base_rate" DECIMAL(5,2) NOT NULL,
    "payment_term_days" INTEGER NOT NULL,
    "segment_overrides" JSONB NOT NULL DEFAULT '{}',
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "source_screen" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_commission_rate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketplace_commission_rate_organization_id_idx" ON "marketplace_commission_rate"("organization_id");

-- CreateIndex
CREATE INDEX "marketplace_commission_rate_store_id_rule_kind_category_id_idx" ON "marketplace_commission_rate"("store_id", "rule_kind", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_commission_rate_dedup" ON "marketplace_commission_rate"("store_id", "rule_kind", "category_id", "brand_id");

-- AddForeignKey
ALTER TABLE "marketplace_commission_rate" ADD CONSTRAINT "marketplace_commission_rate_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_commission_rate" ADD CONSTRAINT "marketplace_commission_rate_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
