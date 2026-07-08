-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('TRENDYOL', 'HEPSIBURADA');

-- CreateEnum
CREATE TYPE "FeeScope" AS ENUM ('TRENDYOL', 'HEPSIBURADA', 'ALL');

-- CreateEnum
CREATE TYPE "StoreEnvironment" AS ENUM ('PRODUCTION', 'SANDBOX');

-- CreateEnum
CREATE TYPE "StoreStatus" AS ENUM ('ACTIVE', 'CONNECTION_ERROR', 'DISABLED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'VERIFIED', 'DISCREPANCY');

-- CreateEnum
CREATE TYPE "SettlementItemType" AS ENUM ('SALE', 'RETURN', 'COMMISSION', 'SHIPPING', 'SERVICE_FEE', 'PROMOTION', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('PRODUCT_COST', 'ADVERTISING', 'PACKAGING', 'SHIPPING_SUPPLY', 'SOFTWARE', 'PERSONNEL', 'RENT', 'OTHER');

-- CreateEnum
CREATE TYPE "SyncType" AS ENUM ('ORDERS', 'PRODUCTS', 'SETTLEMENTS', 'CLAIMS');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'FAILED_RETRYABLE');

-- CreateEnum
CREATE TYPE "SyncErrorCode" AS ENUM ('MARKETPLACE_AUTH_FAILED', 'MARKETPLACE_ACCESS_DENIED', 'MARKETPLACE_UNREACHABLE', 'SYNC_IN_PROGRESS', 'RATE_LIMITED', 'VALIDATION_ERROR', 'INTERNAL_ERROR');

-- CreateEnum
CREATE TYPE "CostProfileType" AS ENUM ('COGS', 'PACKAGING', 'SHIPPING', 'SOFTWARE', 'MARKETING', 'OTHER');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('TRY', 'USD', 'EUR');

-- CreateEnum
CREATE TYPE "FxRateMode" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "ShippingTariffSource" AS ENUM ('TRENDYOL_CONTRACT', 'OWN_CONTRACT');

-- CreateEnum
CREATE TYPE "CommissionRuleKind" AS ENUM ('CATEGORY', 'CATEGORY_BRAND');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('NOT_SETTLED', 'PARTIALLY_SETTLED', 'FULLY_SETTLED');

-- CreateEnum
CREATE TYPE "ProfitExclusionReason" AS ENUM ('COST_DEADLINE_MISSED', 'LATE_UNCOSTED_ARRIVAL', 'LEGACY_BACKFILL');

-- CreateEnum
CREATE TYPE "OrderFeeType" AS ENUM ('SHIPPING', 'PLATFORM_SERVICE', 'PLATFORM_SERVICE_FAST', 'STOPPAGE', 'RETURN_SHIPPING', 'REFUND_DEDUCTION', 'COMMISSION_REFUND', 'COST_RETURN', 'STOPPAGE_REFUND', 'PROVISION_ADJUSTMENT', 'MANUAL_REFUND', 'REVENUE_ADJUSTMENT', 'COMMISSION_ADJUSTMENT', 'CUSTOM', 'ADVERTISING', 'PENALTY_DEFECTIVE', 'PENALTY_WRONG_PRODUCT', 'PENALTY_MISSING_PRODUCT', 'PENALTY_LATE_DELIVERY', 'PENALTY_SUPPLY_FAILURE', 'NOTIFICATION_FEE', 'COMMISSION_INVOICE', 'INTERNATIONAL_SERVICE', 'OVERSEAS_RETURN_OPERATION');

-- CreateEnum
CREATE TYPE "OrderFeeSource" AS ENUM ('ESTIMATE', 'SETTLEMENT', 'CARGO_INVOICE', 'USER_OVERRIDE', 'MANUAL_ENTRY');

-- CreateEnum
CREATE TYPE "OrderFeeDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "FeeCalculationKind" AS ENUM ('FIXED', 'RATE_OF_SALE', 'FORMULA');

-- CreateEnum
CREATE TYPE "buffer_entry_status" AS ENUM ('PENDING', 'PROMOTING', 'FAILED', 'PERMANENT_FAILED');

-- CreateEnum
CREATE TYPE "PriceChangeStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "FlashOfferType" AS ENUM ('H24', 'H3');

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT,
    "avatar_url" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Istanbul',
    "preferred_language" TEXT NOT NULL DEFAULT 'tr',
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Istanbul',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'MEMBER',
    "last_accessed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "environment" "StoreEnvironment" NOT NULL DEFAULT 'PRODUCTION',
    "external_account_id" TEXT NOT NULL,
    "credentials" JSONB NOT NULL,
    "status" "StoreStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_connected_at" TIMESTAMP(3),
    "last_sync_at" TIMESTAMP(3),
    "shipping_tariff_source" "ShippingTariffSource" NOT NULL DEFAULT 'TRENDYOL_CONTRACT',
    "default_shipping_carrier_id" UUID,
    "profit_settings" JSONB NOT NULL DEFAULT '{}',
    "webhook_id" TEXT,
    "webhook_secret" TEXT,
    "webhook_active_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_store_access" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "granted_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_store_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "platform_content_id" BIGINT NOT NULL,
    "product_main_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "brand_id" BIGINT,
    "brand_name" TEXT,
    "category_id" BIGINT,
    "category_name" TEXT,
    "color" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '[]',
    "approved" BOOLEAN NOT NULL DEFAULT true,
    "platform_created_at" TIMESTAMP(3),
    "platform_modified_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "total_stock" INTEGER NOT NULL DEFAULT 0,
    "min_sale_price" DECIMAL(12,2),
    "max_sale_price" DECIMAL(12,2),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "platform_variant_id" BIGINT NOT NULL,
    "barcode" TEXT NOT NULL,
    "stock_code" TEXT NOT NULL,
    "sale_price" DECIMAL(12,2) NOT NULL,
    "list_price" DECIMAL(12,2) NOT NULL,
    "vat_rate" INTEGER,
    "cost_price" DECIMAL(12,2),
    "is_digital" BOOLEAN NOT NULL DEFAULT false,
    "synced_dimensional_weight" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "dimensional_weight" DECIMAL(6,2),
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "delivery_duration" INTEGER,
    "is_rush_delivery" BOOLEAN NOT NULL DEFAULT false,
    "fast_delivery_options" JSONB NOT NULL DEFAULT '[]',
    "product_url" TEXT,
    "location_based_delivery" TEXT,
    "on_sale" BOOLEAN NOT NULL DEFAULT true,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "blacklisted" BOOLEAN NOT NULL DEFAULT false,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "size" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '[]',
    "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "platform_order_id" TEXT NOT NULL,
    "order_date" TIMESTAMP(3) NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "agreed_delivery_date" TIMESTAMP(3),
    "actual_delivery_date" TIMESTAMP(3),
    "actual_ship_date" TIMESTAMP(3),
    "estimated_delivery_start_date" TIMESTAMP(3),
    "estimated_delivery_end_date" TIMESTAMP(3),
    "fast_delivery" BOOLEAN NOT NULL DEFAULT false,
    "fast_delivery_type" TEXT,
    "micro" BOOLEAN NOT NULL DEFAULT false,
    "sale_gross" DECIMAL(12,2),
    "sale_vat" DECIMAL(12,2),
    "list_gross" DECIMAL(12,2),
    "seller_discount_gross" DECIMAL(12,2),
    "seller_discount_vat" DECIMAL(12,2),
    "estimated_sale_margin_pct" DECIMAL(8,4),
    "settled_sale_margin_pct" DECIMAL(8,4),
    "estimated_cost_markup_pct" DECIMAL(8,4),
    "settled_cost_markup_pct" DECIMAL(8,4),
    "promotion_displays" JSONB,
    "estimated_net_profit" DECIMAL(12,2),
    "settled_net_profit" DECIMAL(12,2),
    "estimated_net_vat" DECIMAL(12,2),
    "settled_net_vat" DECIMAL(12,2),
    "snapshot_include_stopaj" BOOLEAN,
    "snapshot_include_negative_net_vat" BOOLEAN,
    "profit_excluded_at" TIMESTAMP(3),
    "profit_exclusion_reason" "ProfitExclusionReason",
    "reconciliation_status" "ReconciliationStatus" NOT NULL DEFAULT 'NOT_SETTLED',
    "payment_order_id" BIGINT,
    "payment_date" TIMESTAMP(3),
    "delivered_on_time" BOOLEAN,
    "platform_order_number" TEXT,
    "cargo_provider_name" TEXT,
    "cargo_tracking_number" BIGINT,
    "cargo_deci" DECIMAL(8,2),
    "uses_seller_cargo_agreement" BOOLEAN NOT NULL DEFAULT false,
    "platform_created_by" TEXT,
    "origin_shipment_date" TIMESTAMP(3),
    "platform_last_modified_at" TIMESTAMP(3),
    "promoted_from_buffer_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_variant_id" UUID,
    "organization_id" UUID,
    "quantity" INTEGER NOT NULL,
    "platform_line_id" BIGINT,
    "barcode" TEXT,
    "variant_resolution_attempts" INTEGER NOT NULL DEFAULT 0,
    "next_resolution_at" TIMESTAMP(3),
    "line_list_gross" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "line_sale_gross" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "line_seller_discount_gross" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sale_vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "commission_rate" DECIMAL(5,2) NOT NULL,
    "commission_gross" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "refunded_commission_gross" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "commission_vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 20,
    "estimated_commission_gross" DECIMAL(12,2),
    "settled_commission_gross" DECIMAL(12,2),
    "settled_sale_amount" DECIMAL(12,2),
    "unit_cost_snapshot_gross" DECIMAL(12,2),
    "unit_cost_snapshot_vat_rate" DECIMAL(5,2),
    "snapshot_captured_at" TIMESTAMP(3),
    "commission_invoice_serial_number" TEXT,
    "commission_invoice_id" UUID,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "platform_settlement_id" TEXT,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "gross_amount" DECIMAL(12,2) NOT NULL,
    "net_amount" DECIMAL(12,2) NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_items" (
    "id" UUID NOT NULL,
    "settlement_id" UUID NOT NULL,
    "order_id" UUID,
    "amount" DECIMAL(12,2) NOT NULL,
    "type" "SettlementItemType" NOT NULL,

    CONSTRAINT "settlement_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_profiles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CostProfileType" NOT NULL,
    "amount_gross" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" "Currency" NOT NULL DEFAULT 'TRY',
    "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "fx_rate_mode" "FxRateMode" NOT NULL DEFAULT 'AUTO',
    "manual_fx_rate" DECIMAL(14,6),
    "note" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_profile_versions" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CostProfileType" NOT NULL,
    "amount_gross" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" "Currency" NOT NULL,
    "vat_rate" DECIMAL(5,2) NOT NULL,
    "fx_rate_mode" "FxRateMode" NOT NULL,
    "manual_fx_rate" DECIMAL(14,6),
    "note" TEXT,
    "archived_at" TIMESTAMP(3),
    "changed_fields" TEXT[],
    "changed_by" UUID,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "change_reason" TEXT,

    CONSTRAINT "cost_profile_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variant_cost_profiles" (
    "id" UUID NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "attached_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attached_by" UUID,

    CONSTRAINT "product_variant_cost_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item_cost_snapshot_components" (
    "id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "profile_name" TEXT NOT NULL,
    "profile_type" "CostProfileType" NOT NULL,
    "amount_gross" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" "Currency" NOT NULL,
    "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "amount_in_try_gross" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "fx_rate_mode" "FxRateMode" NOT NULL,
    "fx_rate_used" DECIMAL(14,6) NOT NULL,
    "fx_rate_source" TEXT NOT NULL,

    CONSTRAINT "order_item_cost_snapshot_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_rates" (
    "id" UUID NOT NULL,
    "currency" "Currency" NOT NULL,
    "rate_date" DATE NOT NULL,
    "rate_to_try" DECIMAL(14,6) NOT NULL,
    "source" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID,
    "category" "ExpenseCategory" NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "date" DATE NOT NULL,
    "is_recurring" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "sync_type" "SyncType" NOT NULL,
    "status" "SyncStatus" NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "records_processed" INTEGER NOT NULL DEFAULT 0,
    "progress_current" INTEGER NOT NULL DEFAULT 0,
    "progress_total" INTEGER,
    "progress_stage" TEXT,
    "error_code" "SyncErrorCode",
    "error_message" TEXT,
    "claimed_at" TIMESTAMPTZ(3),
    "claimed_by" TEXT,
    "last_tick_at" TIMESTAMPTZ(3),
    "page_cursor" JSONB,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    "skipped_pages" JSONB,

    CONSTRAINT "sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "shipping_carriers" (
    "id" UUID NOT NULL,
    "platform" "Platform" NOT NULL,
    "external_id" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "tax_number" TEXT,
    "supports_barem_destek" BOOLEAN NOT NULL DEFAULT true,
    "max_barem_desi" INTEGER NOT NULL DEFAULT 10,
    "max_barem_eligible_delivery_duration" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_carriers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_desi_tariffs" (
    "id" UUID NOT NULL,
    "carrier_id" UUID NOT NULL,
    "desi" INTEGER NOT NULL,
    "price_net" DECIMAL(10,2) NOT NULL,
    "effective_from" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_desi_tariffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_barem_tariffs" (
    "id" UUID NOT NULL,
    "carrier_id" UUID NOT NULL,
    "min_order_amount" DECIMAL(12,2) NOT NULL,
    "max_order_amount" DECIMAL(12,2) NOT NULL,
    "price_net" DECIMAL(10,2) NOT NULL,
    "effective_from" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_barem_tariffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "own_shipping_tariffs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "desi" INTEGER NOT NULL,
    "price_net" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "own_shipping_tariffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_tariffs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "source_filename" TEXT,
    "source_file" BYTEA,
    "week_starts_at" TIMESTAMP(3),
    "week_ends_at" TIMESTAMP(3),
    "exported_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_tariffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_tariff_periods" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "tariff_id" UUID NOT NULL,
    "date_range_label" TEXT NOT NULL,
    "day_count" INTEGER,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_tariff_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_tariff_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "product_variant_id" UUID,
    "barcode" TEXT NOT NULL,
    "stock_code" TEXT,
    "product_title" TEXT NOT NULL,
    "category" TEXT,
    "brand" TEXT,
    "stock" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "current_price" DECIMAL(12,2) NOT NULL,
    "commission_base_price" DECIMAL(12,2),
    "current_commission_pct" DECIMAL(6,4) NOT NULL,
    "bands" JSONB NOT NULL,
    "selected_band" TEXT,
    "custom_price" DECIMAL(12,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_tariff_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plus_commission_tariffs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "source_filename" TEXT,
    "source_file" BYTEA,
    "week_starts_at" TIMESTAMP(3),
    "week_ends_at" TIMESTAMP(3),
    "exported_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plus_commission_tariffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plus_commission_tariff_periods" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "tariff_id" UUID NOT NULL,
    "date_range_label" TEXT NOT NULL,
    "day_count" INTEGER,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plus_commission_tariff_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plus_commission_tariff_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "product_variant_id" UUID,
    "barcode" TEXT NOT NULL,
    "stock_code" TEXT,
    "product_title" TEXT NOT NULL,
    "category" TEXT,
    "brand" TEXT,
    "size" TEXT,
    "model_code" TEXT,
    "stock" INTEGER,
    "current_price" DECIMAL(12,2) NOT NULL,
    "commission_base_price" DECIMAL(12,2) NOT NULL,
    "current_commission_pct" DECIMAL(6,4) NOT NULL,
    "plus_price_upper_limit" DECIMAL(12,2) NOT NULL,
    "plus_commission_pct" DECIMAL(6,4) NOT NULL,
    "plus_commission_base_price" DECIMAL(12,2) NOT NULL,
    "external_id" TEXT,
    "tariff_group" TEXT,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "plus_selected" BOOLEAN NOT NULL DEFAULT false,
    "custom_price" DECIMAL(12,2),
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plus_commission_tariff_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advantage_tariffs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "source_filename" TEXT,
    "source_file" BYTEA,
    "commission_source_tariff_id" UUID,
    "exported_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "advantage_tariffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advantage_tariff_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "tariff_id" UUID NOT NULL,
    "product_variant_id" UUID,
    "barcode" TEXT NOT NULL,
    "stock_code" TEXT,
    "product_title" TEXT NOT NULL,
    "category" TEXT,
    "brand" TEXT,
    "size" TEXT,
    "model_code" TEXT,
    "stock" INTEGER,
    "current_price" DECIMAL(12,2) NOT NULL,
    "customer_price" DECIMAL(12,2) NOT NULL,
    "has_commission_tariff" BOOLEAN NOT NULL,
    "star_tiers" JSONB NOT NULL,
    "apply_until_end" BOOLEAN NOT NULL,
    "external_id" TEXT,
    "tariff_group" TEXT,
    "selected_tier" TEXT,
    "custom_price" DECIMAL(12,2),
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "advantage_tariff_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flash_product_lists" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "source_filename" TEXT,
    "source_file" BYTEA,
    "exported_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flash_product_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flash_product_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "list_id" UUID NOT NULL,
    "product_variant_id" UUID,
    "model_code" TEXT,
    "barcode" TEXT NOT NULL,
    "product_title" TEXT NOT NULL,
    "category" TEXT,
    "brand" TEXT,
    "stock" INTEGER,
    "external_id" TEXT,
    "current_price" DECIMAL(12,2) NOT NULL,
    "customer_price" DECIMAL(12,2) NOT NULL,
    "current_commission_pct" DECIMAL(6,4) NOT NULL,
    "has_commission_tariff" BOOLEAN NOT NULL,
    "campaigned_product" TEXT,
    "offer_24_price" DECIMAL(12,2),
    "offer_24_starts_at" TIMESTAMP(3),
    "offer_24_ends_at" TIMESTAMP(3),
    "offer_3_price" DECIMAL(12,2),
    "offer_3_starts_at" TIMESTAMP(3),
    "offer_3_ends_at" TIMESTAMP(3),
    "selected_offer" "FlashOfferType",
    "custom_price" DECIMAL(12,2),
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flash_product_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_definitions" (
    "id" UUID NOT NULL,
    "platform" "FeeScope" NOT NULL,
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
CREATE TABLE "micro_export_return_fee_tiers" (
    "id" UUID NOT NULL,
    "min_sale_gross" DECIMAL(12,2) NOT NULL,
    "max_sale_gross" DECIMAL(12,2) NOT NULL,
    "rate" DECIMAL(7,4) NOT NULL,
    "effective_from" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "micro_export_return_fee_tiers_pkey" PRIMARY KEY ("id")
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
    "amount_gross" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "display_name" TEXT,
    "external_ref" JSONB,
    "trendyol_transaction_id" TEXT,
    "invoice_serial_number" TEXT,
    "parcel_unique_id" TEXT,
    "derived_from" TEXT,
    "order_claim_item_id" UUID,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),
    "confirmed_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_claims" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "trendyol_claim_id" TEXT NOT NULL,
    "claim_date" TIMESTAMP(3) NOT NULL,
    "cargo_provider_name" TEXT,
    "cargo_tracking_number" BIGINT,
    "resolved" BOOLEAN NOT NULL,
    "order_shipment_package_id" TEXT,
    "order_outbound_package_id" TEXT,
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
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_claim_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_barcode_miss" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "barcode" TEXT NOT NULL,
    "vendor_missing" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "next_retry_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_barcode_miss_pkey" PRIMARY KEY ("id")
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
    "amount_gross" DECIMAL(12,2) NOT NULL,
    "vat_rate" DECIMAL(5,2) NOT NULL,
    "invoice_serial_number" TEXT,
    "description" TEXT,
    "external_ref" JSONB,
    "trendyol_transaction_id" TEXT,
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

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "platform" "Platform" NOT NULL,
    "platform_order_id" TEXT NOT NULL,
    "platform_status" TEXT NOT NULL,
    "platform_last_modified_date" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "processing_error" TEXT,
    "raw_payload" JSONB NOT NULL,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_performance_buffer" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "order_date" DATE NOT NULL,
    "platform_order_id" TEXT NOT NULL,
    "platform_order_number" TEXT NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "mapped_order" JSONB NOT NULL,
    "status" "buffer_entry_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "last_failed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_performance_buffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_change_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "platform" "Platform" NOT NULL,
    "barcode" TEXT NOT NULL,
    "old_sale_price" DECIMAL(12,2) NOT NULL,
    "new_sale_price" DECIMAL(12,2) NOT NULL,
    "list_price" DECIMAL(12,2),
    "trendyol_batch_id" TEXT,
    "status" "PriceChangeStatus" NOT NULL DEFAULT 'PENDING',
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_email_key" ON "user_profiles"("email");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "idx_org_members_user_last_accessed" ON "organization_members"("user_id", "last_accessed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organization_id_user_id_key" ON "organization_members"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "stores_organization_id_idx" ON "stores"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "stores_organization_id_platform_external_account_id_key" ON "stores"("organization_id", "platform", "external_account_id");

-- CreateIndex
CREATE INDEX "member_store_access_store_id_idx" ON "member_store_access"("store_id");

-- CreateIndex
CREATE INDEX "member_store_access_organization_id_idx" ON "member_store_access"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "member_store_access_member_id_store_id_key" ON "member_store_access"("member_id", "store_id");

-- CreateIndex
CREATE INDEX "products_organization_id_idx" ON "products"("organization_id");

-- CreateIndex
CREATE INDEX "products_store_id_product_main_id_idx" ON "products"("store_id", "product_main_id");

-- CreateIndex
CREATE INDEX "products_store_id_brand_id_idx" ON "products"("store_id", "brand_id");

-- CreateIndex
CREATE INDEX "products_store_id_total_stock_idx" ON "products"("store_id", "total_stock");

-- CreateIndex
CREATE INDEX "products_store_id_min_sale_price_max_sale_price_idx" ON "products"("store_id", "min_sale_price", "max_sale_price");

-- CreateIndex
CREATE INDEX "products_store_id_category_id_idx" ON "products"("store_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_store_id_platform_content_id_key" ON "products"("store_id", "platform_content_id");

-- CreateIndex
CREATE INDEX "product_variants_store_id_barcode_idx" ON "product_variants"("store_id", "barcode");

-- CreateIndex
CREATE INDEX "product_variants_organization_id_idx" ON "product_variants"("organization_id");

-- CreateIndex
CREATE INDEX "product_variants_product_id_idx" ON "product_variants"("product_id");

-- CreateIndex
CREATE INDEX "product_variants_store_id_stock_code_idx" ON "product_variants"("store_id", "stock_code");

-- CreateIndex
CREATE INDEX "product_variants_store_id_on_sale_archived_idx" ON "product_variants"("store_id", "on_sale", "archived");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_store_id_platform_variant_id_key" ON "product_variants"("store_id", "platform_variant_id");

-- CreateIndex
CREATE INDEX "product_images_product_id_position_idx" ON "product_images"("product_id", "position");

-- CreateIndex
CREATE INDEX "orders_organization_id_idx" ON "orders"("organization_id");

-- CreateIndex
CREATE INDEX "orders_organization_id_reconciliation_status_idx" ON "orders"("organization_id", "reconciliation_status");

-- CreateIndex
CREATE INDEX "orders_order_date_idx" ON "orders"("order_date");

-- CreateIndex
CREATE INDEX "orders_platform_order_number_idx" ON "orders"("platform_order_number");

-- CreateIndex
CREATE INDEX "orders_store_id_payment_order_id_idx" ON "orders"("store_id", "payment_order_id");

-- CreateIndex
CREATE INDEX "orders_store_id_cargo_tracking_number_idx" ON "orders"("store_id", "cargo_tracking_number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_store_id_platform_order_id_key" ON "orders"("store_id", "platform_order_id");

-- CreateIndex
CREATE INDEX "order_items_organization_id_snapshot_captured_at_idx" ON "order_items"("organization_id", "snapshot_captured_at");

-- CreateIndex
CREATE INDEX "order_items_commission_invoice_id_idx" ON "order_items"("commission_invoice_id");

-- CreateIndex
CREATE INDEX "settlements_organization_id_idx" ON "settlements"("organization_id");

-- CreateIndex
CREATE INDEX "cost_profiles_organization_id_archived_at_idx" ON "cost_profiles"("organization_id", "archived_at");

-- CreateIndex
CREATE INDEX "cost_profiles_organization_id_type_idx" ON "cost_profiles"("organization_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "cost_profiles_organization_id_name_key" ON "cost_profiles"("organization_id", "name");

-- CreateIndex
CREATE INDEX "cost_profile_versions_profile_id_changed_at_idx" ON "cost_profile_versions"("profile_id", "changed_at" DESC);

-- CreateIndex
CREATE INDEX "cost_profile_versions_organization_id_idx" ON "cost_profile_versions"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "cost_profile_versions_profile_id_version_key" ON "cost_profile_versions"("profile_id", "version");

-- CreateIndex
CREATE INDEX "product_variant_cost_profiles_profile_id_idx" ON "product_variant_cost_profiles"("profile_id");

-- CreateIndex
CREATE INDEX "idx_pvcp_org_product_variant" ON "product_variant_cost_profiles"("organization_id", "product_variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variant_cost_profiles_product_variant_id_profile_id_key" ON "product_variant_cost_profiles"("product_variant_id", "profile_id");

-- CreateIndex
CREATE INDEX "order_item_cost_snapshot_components_order_item_id_idx" ON "order_item_cost_snapshot_components"("order_item_id");

-- CreateIndex
CREATE INDEX "idx_oi_cost_snapshot_org_profile_type" ON "order_item_cost_snapshot_components"("organization_id", "profile_type");

-- CreateIndex
CREATE INDEX "idx_oi_cost_snapshot_org_profile_id" ON "order_item_cost_snapshot_components"("organization_id", "profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "fx_rates_currency_rate_date_key" ON "fx_rates"("currency", "rate_date");

-- CreateIndex
CREATE INDEX "expenses_organization_id_idx" ON "expenses"("organization_id");

-- CreateIndex
CREATE INDEX "sync_logs_organization_id_idx" ON "sync_logs"("organization_id");

-- CreateIndex
CREATE INDEX "sync_logs_store_id_started_at_idx" ON "sync_logs"("store_id", "started_at");

-- CreateIndex
CREATE INDEX "sync_logs_status_next_attempt_at_idx" ON "sync_logs"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "marketplace_commission_rate_platform_rule_kind_category_id_idx" ON "marketplace_commission_rate"("platform", "rule_kind", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_commission_rate_dedup" ON "marketplace_commission_rate"("platform", "rule_kind", "category_id", "brand_id");

-- CreateIndex
CREATE INDEX "shipping_carriers_platform_active_idx" ON "shipping_carriers"("platform", "active");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_carriers_platform_external_id_key" ON "shipping_carriers"("platform", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_carriers_platform_code_key" ON "shipping_carriers"("platform", "code");

-- CreateIndex
CREATE INDEX "shipping_desi_tariffs_carrier_id_desi_idx" ON "shipping_desi_tariffs"("carrier_id", "desi");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_desi_tariffs_carrier_id_desi_key" ON "shipping_desi_tariffs"("carrier_id", "desi");

-- CreateIndex
CREATE INDEX "shipping_barem_tariffs_carrier_id_idx" ON "shipping_barem_tariffs"("carrier_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_barem_tariffs_carrier_id_min_order_amount_max_orde_key" ON "shipping_barem_tariffs"("carrier_id", "min_order_amount", "max_order_amount");

-- CreateIndex
CREATE INDEX "own_shipping_tariffs_organization_id_idx" ON "own_shipping_tariffs"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "own_shipping_tariffs_store_id_desi_key" ON "own_shipping_tariffs"("store_id", "desi");

-- CreateIndex
CREATE INDEX "commission_tariffs_organization_id_idx" ON "commission_tariffs"("organization_id");

-- CreateIndex
CREATE INDEX "commission_tariffs_store_id_idx" ON "commission_tariffs"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "commission_tariffs_store_id_week_starts_at_key" ON "commission_tariffs"("store_id", "week_starts_at");

-- CreateIndex
CREATE INDEX "commission_tariff_periods_organization_id_idx" ON "commission_tariff_periods"("organization_id");

-- CreateIndex
CREATE INDEX "commission_tariff_periods_tariff_id_idx" ON "commission_tariff_periods"("tariff_id");

-- CreateIndex
CREATE UNIQUE INDEX "commission_tariff_periods_tariff_id_sort_order_key" ON "commission_tariff_periods"("tariff_id", "sort_order");

-- CreateIndex
CREATE INDEX "commission_tariff_items_organization_id_idx" ON "commission_tariff_items"("organization_id");

-- CreateIndex
CREATE INDEX "commission_tariff_items_period_id_idx" ON "commission_tariff_items"("period_id");

-- CreateIndex
CREATE INDEX "commission_tariff_items_store_id_barcode_idx" ON "commission_tariff_items"("store_id", "barcode");

-- CreateIndex
CREATE INDEX "plus_commission_tariffs_organization_id_idx" ON "plus_commission_tariffs"("organization_id");

-- CreateIndex
CREATE INDEX "plus_commission_tariffs_store_id_idx" ON "plus_commission_tariffs"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "plus_commission_tariffs_store_id_week_starts_at_key" ON "plus_commission_tariffs"("store_id", "week_starts_at");

-- CreateIndex
CREATE INDEX "plus_commission_tariff_periods_organization_id_idx" ON "plus_commission_tariff_periods"("organization_id");

-- CreateIndex
CREATE INDEX "plus_commission_tariff_periods_tariff_id_idx" ON "plus_commission_tariff_periods"("tariff_id");

-- CreateIndex
CREATE UNIQUE INDEX "plus_commission_tariff_periods_tariff_id_sort_order_key" ON "plus_commission_tariff_periods"("tariff_id", "sort_order");

-- CreateIndex
CREATE INDEX "plus_commission_tariff_items_organization_id_idx" ON "plus_commission_tariff_items"("organization_id");

-- CreateIndex
CREATE INDEX "plus_commission_tariff_items_period_id_idx" ON "plus_commission_tariff_items"("period_id");

-- CreateIndex
CREATE INDEX "plus_commission_tariff_items_store_id_barcode_idx" ON "plus_commission_tariff_items"("store_id", "barcode");

-- CreateIndex
CREATE INDEX "advantage_tariffs_organization_id_idx" ON "advantage_tariffs"("organization_id");

-- CreateIndex
CREATE INDEX "advantage_tariffs_store_id_idx" ON "advantage_tariffs"("store_id");

-- CreateIndex
CREATE INDEX "advantage_tariffs_commission_source_tariff_id_idx" ON "advantage_tariffs"("commission_source_tariff_id");

-- CreateIndex
CREATE INDEX "advantage_tariff_items_organization_id_idx" ON "advantage_tariff_items"("organization_id");

-- CreateIndex
CREATE INDEX "advantage_tariff_items_tariff_id_idx" ON "advantage_tariff_items"("tariff_id");

-- CreateIndex
CREATE INDEX "advantage_tariff_items_store_id_barcode_idx" ON "advantage_tariff_items"("store_id", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "advantage_tariff_items_tariff_id_sort_order_key" ON "advantage_tariff_items"("tariff_id", "sort_order");

-- CreateIndex
CREATE INDEX "flash_product_lists_organization_id_idx" ON "flash_product_lists"("organization_id");

-- CreateIndex
CREATE INDEX "flash_product_lists_store_id_idx" ON "flash_product_lists"("store_id");

-- CreateIndex
CREATE INDEX "flash_product_items_organization_id_idx" ON "flash_product_items"("organization_id");

-- CreateIndex
CREATE INDEX "flash_product_items_list_id_idx" ON "flash_product_items"("list_id");

-- CreateIndex
CREATE INDEX "flash_product_items_store_id_barcode_idx" ON "flash_product_items"("store_id", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "flash_product_items_list_id_sort_order_key" ON "flash_product_items"("list_id", "sort_order");

-- CreateIndex
CREATE INDEX "fee_definitions_platform_effective_from_idx" ON "fee_definitions"("platform", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "fee_definitions_platform_fee_type_effective_from_key" ON "fee_definitions"("platform", "fee_type", "effective_from");

-- CreateIndex
CREATE INDEX "micro_export_return_fee_tiers_min_sale_gross_max_sale_gross_idx" ON "micro_export_return_fee_tiers"("min_sale_gross", "max_sale_gross");

-- CreateIndex
CREATE UNIQUE INDEX "micro_export_return_fee_tiers_min_sale_gross_max_sale_gross_key" ON "micro_export_return_fee_tiers"("min_sale_gross", "max_sale_gross", "effective_from");

-- CreateIndex
CREATE INDEX "order_fees_organization_id_fee_type_idx" ON "order_fees"("organization_id", "fee_type");

-- CreateIndex
CREATE INDEX "order_fees_order_id_fee_type_source_idx" ON "order_fees"("order_id", "fee_type", "source");

-- CreateIndex
CREATE INDEX "order_fees_order_claim_item_id_idx" ON "order_fees"("order_claim_item_id");

-- CreateIndex
CREATE INDEX "order_claims_organization_id_resolved_idx" ON "order_claims"("organization_id", "resolved");

-- CreateIndex
CREATE INDEX "order_claims_store_id_order_shipment_package_id_idx" ON "order_claims"("store_id", "order_shipment_package_id");

-- CreateIndex
CREATE INDEX "order_claims_store_id_resolved_idx" ON "order_claims"("store_id", "resolved");

-- CreateIndex
CREATE UNIQUE INDEX "order_claims_order_id_trendyol_claim_id_key" ON "order_claims"("order_id", "trendyol_claim_id");

-- CreateIndex
CREATE INDEX "order_claim_items_order_item_id_idx" ON "order_claim_items"("order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_claim_items_claim_id_trendyol_claim_item_id_key" ON "order_claim_items"("claim_id", "trendyol_claim_item_id");

-- CreateIndex
CREATE INDEX "catalog_barcode_miss_organization_id_idx" ON "catalog_barcode_miss"("organization_id");

-- CreateIndex
CREATE INDEX "catalog_barcode_miss_store_id_next_retry_at_idx" ON "catalog_barcode_miss"("store_id", "next_retry_at");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_barcode_miss_store_id_barcode_key" ON "catalog_barcode_miss"("store_id", "barcode");

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

-- CreateIndex
CREATE INDEX "webhook_events_organization_id_received_at_idx" ON "webhook_events"("organization_id", "received_at" DESC);

-- CreateIndex
CREATE INDEX "webhook_events_store_id_received_at_idx" ON "webhook_events"("store_id", "received_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_store_id_platform_order_id_platform_status_p_key" ON "webhook_events"("store_id", "platform_order_id", "platform_status", "platform_last_modified_date");

-- CreateIndex
CREATE INDEX "live_performance_buffer_store_id_order_date_idx" ON "live_performance_buffer"("store_id", "order_date");

-- CreateIndex
CREATE INDEX "live_performance_buffer_status_last_failed_at_idx" ON "live_performance_buffer"("status", "last_failed_at");

-- CreateIndex
CREATE INDEX "live_performance_buffer_organization_id_idx" ON "live_performance_buffer"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "live_performance_buffer_store_id_platform_order_id_key" ON "live_performance_buffer"("store_id", "platform_order_id");

-- CreateIndex
CREATE INDEX "price_change_logs_organization_id_idx" ON "price_change_logs"("organization_id");

-- CreateIndex
CREATE INDEX "price_change_logs_store_id_created_at_idx" ON "price_change_logs"("store_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "price_change_logs_variant_id_created_at_idx" ON "price_change_logs"("variant_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_default_shipping_carrier_id_fkey" FOREIGN KEY ("default_shipping_carrier_id") REFERENCES "shipping_carriers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_store_access" ADD CONSTRAINT "member_store_access_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "organization_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_store_access" ADD CONSTRAINT "member_store_access_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_store_access" ADD CONSTRAINT "member_store_access_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_commission_invoice_id_fkey" FOREIGN KEY ("commission_invoice_id") REFERENCES "commission_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_profiles" ADD CONSTRAINT "cost_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_profile_versions" ADD CONSTRAINT "cost_profile_versions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "cost_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variant_cost_profiles" ADD CONSTRAINT "product_variant_cost_profiles_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variant_cost_profiles" ADD CONSTRAINT "product_variant_cost_profiles_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "cost_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_cost_snapshot_components" ADD CONSTRAINT "order_item_cost_snapshot_components_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_cost_snapshot_components" ADD CONSTRAINT "order_item_cost_snapshot_components_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "cost_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_desi_tariffs" ADD CONSTRAINT "shipping_desi_tariffs_carrier_id_fkey" FOREIGN KEY ("carrier_id") REFERENCES "shipping_carriers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_barem_tariffs" ADD CONSTRAINT "shipping_barem_tariffs_carrier_id_fkey" FOREIGN KEY ("carrier_id") REFERENCES "shipping_carriers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "own_shipping_tariffs" ADD CONSTRAINT "own_shipping_tariffs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_tariffs" ADD CONSTRAINT "commission_tariffs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_tariff_periods" ADD CONSTRAINT "commission_tariff_periods_tariff_id_fkey" FOREIGN KEY ("tariff_id") REFERENCES "commission_tariffs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_tariff_items" ADD CONSTRAINT "commission_tariff_items_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "commission_tariff_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plus_commission_tariffs" ADD CONSTRAINT "plus_commission_tariffs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plus_commission_tariff_periods" ADD CONSTRAINT "plus_commission_tariff_periods_tariff_id_fkey" FOREIGN KEY ("tariff_id") REFERENCES "plus_commission_tariffs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plus_commission_tariff_items" ADD CONSTRAINT "plus_commission_tariff_items_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "plus_commission_tariff_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advantage_tariffs" ADD CONSTRAINT "advantage_tariffs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advantage_tariffs" ADD CONSTRAINT "advantage_tariffs_commission_source_tariff_id_fkey" FOREIGN KEY ("commission_source_tariff_id") REFERENCES "commission_tariffs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advantage_tariff_items" ADD CONSTRAINT "advantage_tariff_items_tariff_id_fkey" FOREIGN KEY ("tariff_id") REFERENCES "advantage_tariffs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flash_product_lists" ADD CONSTRAINT "flash_product_lists_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flash_product_items" ADD CONSTRAINT "flash_product_items_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "flash_product_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_fees" ADD CONSTRAINT "order_fees_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_fees" ADD CONSTRAINT "order_fees_fee_definition_id_fkey" FOREIGN KEY ("fee_definition_id") REFERENCES "fee_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_fees" ADD CONSTRAINT "order_fees_order_claim_item_id_fkey" FOREIGN KEY ("order_claim_item_id") REFERENCES "order_claim_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_claims" ADD CONSTRAINT "order_claims_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_claims" ADD CONSTRAINT "order_claims_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_claim_items" ADD CONSTRAINT "order_claim_items_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "order_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_claim_items" ADD CONSTRAINT "order_claim_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_barcode_miss" ADD CONSTRAINT "catalog_barcode_miss_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_barcode_miss" ADD CONSTRAINT "catalog_barcode_miss_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_period_fees" ADD CONSTRAINT "org_period_fees_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_invoices" ADD CONSTRAINT "commission_invoices_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_performance_buffer" ADD CONSTRAINT "live_performance_buffer_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_performance_buffer" ADD CONSTRAINT "live_performance_buffer_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_change_logs" ADD CONSTRAINT "price_change_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_change_logs" ADD CONSTRAINT "price_change_logs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_change_logs" ADD CONSTRAINT "price_change_logs_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

