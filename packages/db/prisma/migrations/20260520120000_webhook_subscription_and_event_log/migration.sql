-- PR-C1: Trendyol webhook subscription + WebhookEvent idempotency log
-- design: docs/plans/2026-05-20-trendyol-webhook-receiver-design.md §5
--
-- 1. stores: Trendyol webhook subscription metadata (id + encrypted Basic Auth
--    credential + active timestamp). Üçü de nullable — register fail veya
--    non-TRENDYOL platformlar için.
-- 2. webhook_events: idempotency log + raw audit trail. Composite unique key
--    (storeId, platformOrderId, platformStatus, platformLastModifiedDate) →
--    re-delivery'de INSERT P2002 → handler 200 OK döner, downstream call yapmaz.
-- 3. RLS: SELECT yalnız organization member'larına; INSERT/UPDATE/DELETE service
--    role (webhook handler postgres). is_org_member() PR-1'de SECURITY DEFINER
--    STABLE helper'ı kullanılır.

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "webhook_active_at" TIMESTAMP(3),
ADD COLUMN     "webhook_id" TEXT,
ADD COLUMN     "webhook_secret" TEXT;

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

-- CreateIndex
CREATE INDEX "webhook_events_organization_id_received_at_idx" ON "webhook_events"("organization_id", "received_at" DESC);

-- CreateIndex
CREATE INDEX "webhook_events_store_id_received_at_idx" ON "webhook_events"("store_id", "received_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_store_id_platform_order_id_platform_status_p_key" ON "webhook_events"("store_id", "platform_order_id", "platform_status", "platform_last_modified_date");

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── RLS — webhook_events org-scoped SELECT ──────────────────────────────
-- Service role (Prisma postgres) RLS'yi bypass eder; INSERT/UPDATE/DELETE
-- handler tarafından yapılır. SELECT policy admin/owner debugging için.
ALTER TABLE "webhook_events" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "webhook_events_org_member_select" ON "webhook_events"
    FOR SELECT
    USING (is_org_member(organization_id));
