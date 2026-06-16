-- GROSS konvansiyon: OrderItem satır-seviyesi kolonlar (2026-06-16)
-- NET kolonlar kaldırılır, GROSS + vatRate kolonlar eklenir.
-- Pre-launch: veri yok, backfill yok.

ALTER TABLE "order_items"
  -- 7 net satış/maliyet kolonunu kaldır
  DROP COLUMN IF EXISTS "unit_price_net",
  DROP COLUMN IF EXISTS "unit_vat_amount",
  DROP COLUMN IF EXISTS "unit_vat_rate",
  DROP COLUMN IF EXISTS "seller_discount_net",
  DROP COLUMN IF EXISTS "seller_discount_vat_amount",
  DROP COLUMN IF EXISTS "unit_cost_snapshot_net",
  DROP COLUMN IF EXISTS "unit_cost_snapshot_vat_amount",

  -- Eski legacy KDV-dahil kolonları kaldır (PR-5c planı; bu migration'da temizlendi)
  DROP COLUMN IF EXISTS "unit_price",
  DROP COLUMN IF EXISTS "commission_amount",
  DROP COLUMN IF EXISTS "unit_cost_snapshot",

  -- Eski net-bazlı komisyon kolonlarını kaldır (gross karşılıkları ekleniyor)
  DROP COLUMN IF EXISTS "gross_commission_amount_net",
  DROP COLUMN IF EXISTS "gross_commission_vat_amount",
  DROP COLUMN IF EXISTS "refunded_commission_amount_net",
  DROP COLUMN IF EXISTS "refunded_commission_vat_amount",
  DROP COLUMN IF EXISTS "estimated_gross_commission_amount_net",
  DROP COLUMN IF EXISTS "estimated_gross_commission_vat_amount",
  DROP COLUMN IF EXISTS "estimated_refunded_commission_amount_net",
  DROP COLUMN IF EXISTS "estimated_refunded_commission_vat_amount",

  -- Yeni gross satış kolonları
  ADD COLUMN "line_list_gross" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "line_sale_gross" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "line_seller_discount_gross" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "sale_vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 20,

  -- Yeni gross komisyon kolonları
  -- commission_rate zaten var (DROP YOK)
  ADD COLUMN "commission_gross" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "refunded_commission_gross" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "commission_vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 20,
  ADD COLUMN "estimated_commission_gross" DECIMAL(12,2),
  ADD COLUMN "settled_commission_gross" DECIMAL(12,2),

  -- Yeni gross maliyet kolonu (unit_cost_snapshot_vat_rate zaten var → DROP YOK)
  ADD COLUMN "unit_cost_snapshot_gross" DECIMAL(12,2);
