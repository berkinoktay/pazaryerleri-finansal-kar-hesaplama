-- Reference seed extracted VERBATIM from Prisma migration
--   20260610090000_cargo_invoice_foundation/migration.sql
-- during the 2026-07-08 migration-history baseline squash (the migration
-- folder was removed in favour of a single 0_init baseline). This file is
-- now owned by the db seed and test-support scripts, which read the marked
-- seed section out of it at runtime. Do NOT hand-edit the SQL below; it is
-- a byte-for-byte copy of the original migration body.

-- PR-8 Cargo-invoice foundation (research 2026-06-09:
-- docs/integrations/trendyol/research/2026-06-09-cargo-split-kesif.md)
--
-- orders: kargo alanları. cargoTrackingNumber paket olusurken atanir ve kargo
-- faturasi satirindaki parcelUniqueId ile BIREBIR AYNIDIR (prod kanitli) —
-- fatura→siparis eslestirmesinin birincil anahtari. cargo_deci Trendyol'un
-- olctugu desi (prod-only; stage'de gelmez). uses_seller_cargo_agreement
-- Trendyol whoPays==1 esmesi: satici kendi kargo anlasmasini kullaniyor,
-- Trendyol kargo faturasi kesmez. platform_created_by paket kaynagi
-- ("order-creation"/"split"/"transfer") — split soy agaci. origin_shipment_date
-- kargoya-hazir ani (true UTC).
--
-- order_items: platform_line_id (Trendyol lines[].lineId — ayni varianttan iki
-- ayri satirin ayrimi) + barcode (variant eslesmezse elde kalan urun izi).
--
-- fee_definitions: TRENDYOL/SHIPPING satiri. Tutar NULL (gercek tutar kargo
-- faturasindan per-order gelir, RETURN_SHIPPING kalibi); default_vat_rate
-- %20 — kargo faturasi KDV DAHIL gelir ("KDV tevkifat uygulanmamistir"),
-- split orani koddan DEGIL bu tablodan okunur. Oran degisirse yeni
-- effective_from satiri eklenir, kod dokunulmaz.

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "cargo_provider_name" TEXT,
ADD COLUMN "cargo_tracking_number" BIGINT,
ADD COLUMN "cargo_deci" DECIMAL(8,2),
ADD COLUMN "uses_seller_cargo_agreement" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "platform_created_by" TEXT,
ADD COLUMN "origin_shipment_date" TIMESTAMP(3);

-- CreateIndex (kargo faturasi eslestirme lookup'i)
CREATE INDEX "orders_store_id_cargo_tracking_number_idx" ON "orders"("store_id", "cargo_tracking_number");

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN "platform_line_id" BIGINT,
ADD COLUMN "barcode" TEXT;

-- ─── Seed: fee_definitions (Trendyol SHIPPING — PR-8) ────────────────
INSERT INTO fee_definitions (id, platform, fee_type, display_name, calculation_kind, fixed_amount_net, rate_of_sale, default_vat_rate, effective_from, effective_to, is_required, created_at, updated_at)
VALUES
  ('11111111-1111-1111-1111-000000000005', 'TRENDYOL', 'SHIPPING', 'Kargo Bedeli', 'FIXED', NULL, NULL, 20.00, '2026-05-18 00:00:00', NULL, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (platform, fee_type, effective_from) DO NOTHING;
