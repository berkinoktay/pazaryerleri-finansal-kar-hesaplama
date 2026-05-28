-- Live Performance buffer (Spec 2 PR-A) — cost-eksik bugünkü siparişlerin
-- grace-period buffer'ı. Webhook receiver (PR-B) buraya yazar; cost-attach
-- (PR-D) cost geldiğinde PROMOTING'e çevirir; promote worker (PR-C) orders'a
-- taşıyıp satırı siler.
--
-- RLS NOTE: store-scoped SELECT policy (can_access_store(store_id)) ve diğer
-- politikalar canonik olarak supabase/sql/rls-policies.sql'de yaşar ve
-- `pnpm db:apply-policies` ile uygulanır (is_org_member / member_store_access
-- ile aynı mekanizma — none of them live in migrations). Bu migration yalnız
-- tablo DDL'i taşır. updated_at: Prisma @updatedAt uygulama katmanında yönetir
-- (DB default yok, trigger yok).

-- CreateEnum
CREATE TYPE "buffer_entry_status" AS ENUM ('PENDING', 'PROMOTING', 'FAILED', 'PERMANENT_FAILED');

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

-- CreateIndex
CREATE INDEX "live_performance_buffer_store_id_order_date_idx" ON "live_performance_buffer"("store_id", "order_date");

-- CreateIndex
CREATE INDEX "live_performance_buffer_status_last_failed_at_idx" ON "live_performance_buffer"("status", "last_failed_at");

-- CreateIndex
CREATE INDEX "live_performance_buffer_organization_id_idx" ON "live_performance_buffer"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "live_performance_buffer_store_id_platform_order_id_key" ON "live_performance_buffer"("store_id", "platform_order_id");

-- AddForeignKey
ALTER TABLE "live_performance_buffer" ADD CONSTRAINT "live_performance_buffer_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_performance_buffer" ADD CONSTRAINT "live_performance_buffer_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
