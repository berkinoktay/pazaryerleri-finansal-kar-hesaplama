ALTER TABLE "orders"
  DROP COLUMN "sale_subtotal_net", DROP COLUMN "sale_vat_total",
  ADD COLUMN "sale_gross" DECIMAL(12,2),
  ADD COLUMN "sale_vat" DECIMAL(12,2),
  ADD COLUMN "list_gross" DECIMAL(12,2),
  ADD COLUMN "seller_discount_gross" DECIMAL(12,2),
  ADD COLUMN "seller_discount_vat" DECIMAL(12,2),
  ADD COLUMN "estimated_sale_margin_pct" DECIMAL(8,4),
  ADD COLUMN "settled_sale_margin_pct" DECIMAL(8,4),
  ADD COLUMN "estimated_cost_markup_pct" DECIMAL(8,4),
  ADD COLUMN "settled_cost_markup_pct" DECIMAL(8,4),
  ADD COLUMN "promotion_displays" JSONB;
