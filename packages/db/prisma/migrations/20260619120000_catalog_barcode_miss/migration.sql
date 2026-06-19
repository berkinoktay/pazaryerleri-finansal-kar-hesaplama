-- CatalogBarcodeMiss — onaylı katalog-boşluğu barkodları (sipariş bir barkodla
-- geldi ama barkod satıcının kataloğunda yok). Eager katalog-onarımı barkodu
-- Trendyol'dan tek-tek çeker; Trendyol gerçekten ürün dönmüyorsa (404/boş) satır
-- "eşleşme bekliyor" kalır ve sonsuza dek yeniden sorgulanır. Bu tablo eksik
-- barkodları mağaza başına kaydeder → yeniden deneme seyrek (vendorMissing=true
-- için ~24s) yapılabilir, UI "Trendyol kataloğunda yok" gösterebilir.
--
-- RLS NOTE: store-scoped SELECT policy (can_access_store(store_id)) canonik
-- olarak supabase/sql/rls-policies.sql'de yaşar ve `pnpm db:apply-policies` ile
-- uygulanır (live_performance_buffer / orders ile aynı mekanizma — none of them
-- live in migrations). Bu migration yalnız tablo DDL'i taşır. updated_at: Prisma
-- @updatedAt uygulama katmanında yönetir (DB default yok, trigger yok).
--
-- IF NOT EXISTS: bu repo dev'de db:push-only çalışır; canonik kaynak Prisma
-- şemasıdır. Migration prod-parity + idempotent geçiş için yazılır.

-- CreateTable
CREATE TABLE IF NOT EXISTS "catalog_barcode_miss" (
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

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_barcode_miss_store_id_barcode_key" ON "catalog_barcode_miss"("store_id", "barcode");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "catalog_barcode_miss_organization_id_idx" ON "catalog_barcode_miss"("organization_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "catalog_barcode_miss_store_id_next_retry_at_idx" ON "catalog_barcode_miss"("store_id", "next_retry_at");

-- AddForeignKey
ALTER TABLE "catalog_barcode_miss" ADD CONSTRAINT "catalog_barcode_miss_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_barcode_miss" ADD CONSTRAINT "catalog_barcode_miss_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
