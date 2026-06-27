-- Add profit_settings JSONB column to stores.
--
-- Per-store profit-formula toggles (includeStopaj, includeNegativeNetVat) as a
-- JSONB blob — extensible, mirrors user_profiles.preferences. Default '{}' means
-- existing rows are unaffected and resolve to defaults at read time
-- (@pazarsync/utils resolveProfitSettings: includeStopaj=true, includeNegativeNetVat=false).
-- Snapshot-at-create: this is the LIVE setting; it is snapshotted onto the order
-- at order-create time, so changing it only affects orders created afterwards.
-- stores already has org-scoped RLS; this row-agnostic column needs NO policy change.

ALTER TABLE "stores"
  ADD COLUMN "profit_settings" JSONB NOT NULL DEFAULT '{}'::jsonb;
