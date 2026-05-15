-- CreateEnum
CREATE TYPE "CommissionRuleKind" AS ENUM ('CATEGORY', 'CATEGORY_BRAND');

-- CreateTable
-- Platform-scoped reference data: tariff is shared across all sellers/tenants
-- on a given marketplace. RLS allows any authenticated user to SELECT (see
-- supabase/sql/rls-policies.sql).
CREATE TABLE "marketplace_commission_rate" (
    "id" UUID NOT NULL,
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
CREATE INDEX "marketplace_commission_rate_platform_rule_kind_category_id_idx" ON "marketplace_commission_rate"("platform", "rule_kind", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_commission_rate_dedup" ON "marketplace_commission_rate"("platform", "rule_kind", "category_id", "brand_id");
