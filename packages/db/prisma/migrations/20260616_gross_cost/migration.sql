ALTER TABLE "cost_profiles"
  DROP COLUMN "amount", DROP COLUMN "vat_amount",
  ADD COLUMN "amount_gross" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ALTER COLUMN "vat_rate" TYPE DECIMAL(5,2) USING vat_rate::DECIMAL(5,2);

ALTER TABLE "cost_profile_versions"
  DROP COLUMN "amount", DROP COLUMN "vat_amount",
  ADD COLUMN "amount_gross" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ALTER COLUMN "vat_rate" TYPE DECIMAL(5,2) USING vat_rate::DECIMAL(5,2);

ALTER TABLE "order_item_cost_snapshot_components"
  DROP COLUMN "amount", DROP COLUMN "vat_amount",
  DROP COLUMN "amount_in_try", DROP COLUMN "vat_amount_in_try",
  ADD COLUMN "amount_gross" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "amount_in_try_gross" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ALTER COLUMN "vat_rate" TYPE DECIMAL(5,2) USING vat_rate::DECIMAL(5,2);

-- Update check constraints: vat_amount_nonneg -> vat_rate_nonneg
ALTER TABLE cost_profiles DROP CONSTRAINT IF EXISTS cost_profiles_vat_amount_nonneg;
ALTER TABLE cost_profiles DROP CONSTRAINT IF EXISTS cost_profiles_vat_rate_nonneg;
ALTER TABLE cost_profiles ADD CONSTRAINT cost_profiles_vat_rate_nonneg CHECK (vat_rate >= 0);

ALTER TABLE cost_profile_versions DROP CONSTRAINT IF EXISTS cost_profile_versions_vat_amount_nonneg;
ALTER TABLE cost_profile_versions DROP CONSTRAINT IF EXISTS cost_profile_versions_vat_rate_nonneg;
ALTER TABLE cost_profile_versions ADD CONSTRAINT cost_profile_versions_vat_rate_nonneg CHECK (vat_rate >= 0);

ALTER TABLE order_item_cost_snapshot_components DROP CONSTRAINT IF EXISTS order_item_cost_snapshot_components_vat_amount_nonneg;
ALTER TABLE order_item_cost_snapshot_components DROP CONSTRAINT IF EXISTS order_item_cost_snapshot_components_vat_amount_in_try_nonneg;
ALTER TABLE order_item_cost_snapshot_components DROP CONSTRAINT IF EXISTS order_item_cost_snapshot_components_vat_rate_nonneg;
ALTER TABLE order_item_cost_snapshot_components ADD CONSTRAINT order_item_cost_snapshot_components_vat_rate_nonneg CHECK (vat_rate >= 0);
