-- #297 Settlement fee idempotency: JSONB path okumaları → gerçek kolonlar +
-- partial unique indexler (hand-written; shadow replay broken — PR-8 precedent).
--
-- externalRef JSONB bundan sonra AUDIT-ONLY: kaynak-bazlı kimlik anahtarları
-- (trendyolId / invoiceSerialNumber+parcelUniqueId / derivedFrom) indexlenebilir
-- kolonlara taşınır. Çift fee yazımı artık kod disiplini değil, DB-seviyesi
-- UNIQUE guard'la imkânsız (#291'deki sessiz tek-fee durumunun kök tedavisi).
--
-- Partial unique'lar Prisma şemasında ifade edilemediği için burada + governance
-- mirror'da (supabase/sql/check-constraints.sql, db:push yolunda apply-policies
-- uygular) yaşar — check-constraints.sql header'ındaki aynalama konvansiyonu.

-- AlterTable: order_fees idempotency kimlik kolonları
ALTER TABLE "order_fees" ADD COLUMN "trendyol_transaction_id" TEXT,
ADD COLUMN "invoice_serial_number" TEXT,
ADD COLUMN "parcel_unique_id" TEXT,
ADD COLUMN "derived_from" TEXT;

-- AlterTable: order_fees.updated_at — denetimde eksik bulundu (tüm tablolarda
-- created_at/updated_at kuralı; capturedAt created_at rolünde). Backfill
-- default'u doldurur, sonra düşer — @updatedAt değeri uygulama katmanında
-- Prisma yönetir (claims_sync_foundation precedent).
ALTER TABLE "order_fees" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "order_fees" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable: org_period_fees aynı tedavi
ALTER TABLE "org_period_fees" ADD COLUMN "trendyol_transaction_id" TEXT;

-- Backfill: mevcut satırların kimlikleri external_ref audit anahtarlarından
-- (dev'de veri kıymetsiz — basit tut; launch-time deploy yolu için doğru sıra:
-- önce backfill, sonra unique index).
UPDATE "order_fees"
SET "trendyol_transaction_id" = "external_ref"->>'trendyolId'
WHERE "source" = 'SETTLEMENT' AND "external_ref" ? 'trendyolId';

UPDATE "order_fees"
SET "invoice_serial_number" = "external_ref"->>'invoiceSerialNumber',
    "parcel_unique_id"      = "external_ref"->>'parcelUniqueId'
WHERE "source" = 'CARGO_INVOICE'
  AND "external_ref" ? 'invoiceSerialNumber'
  AND "external_ref" ? 'parcelUniqueId';

UPDATE "order_fees"
SET "derived_from" = "external_ref"->>'derivedFrom'
WHERE "external_ref" ? 'derivedFrom';

UPDATE "org_period_fees"
SET "trendyol_transaction_id" = "external_ref"->>'trendyolId'
WHERE "external_ref" ? 'trendyolId';

-- CreateIndex: partial unique guard'lar (mirror: check-constraints.sql).
-- Return üçlüsü aynı trendyol_transaction_id'yi paylaşır → fee_type anahtarda.
CREATE UNIQUE INDEX IF NOT EXISTS "order_fees_settlement_leg_uniq"
  ON "order_fees" ("order_id", "fee_type", "trendyol_transaction_id")
  WHERE "source" = 'SETTLEMENT' AND "trendyol_transaction_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "order_fees_cargo_invoice_line_uniq"
  ON "order_fees" ("order_id", "invoice_serial_number", "parcel_unique_id")
  WHERE "source" = 'CARGO_INVOICE'
    AND "invoice_serial_number" IS NOT NULL
    AND "parcel_unique_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "order_fees_derived_correction_uniq"
  ON "order_fees" ("order_id", "fee_type", "derived_from")
  WHERE "derived_from" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "org_period_fees_settlement_row_uniq"
  ON "org_period_fees" ("organization_id", "fee_type", "trendyol_transaction_id")
  WHERE "trendyol_transaction_id" IS NOT NULL;
