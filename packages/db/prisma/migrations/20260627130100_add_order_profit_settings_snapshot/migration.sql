-- Snapshot of the store's profit-formula settings at order-create time.
--
-- Forward-only: written ONCE by applyEstimateOnOrderCreate from the store's live
-- Store.profit_settings; never backfilled. Every later computation (cargo-refinement
-- re-entry + settlement recompute) reads this snapshot, NOT the live store setting.
-- Changing a store's setting therefore only affects orders created afterwards.
--
-- Nullable (no default) — historical / profit-excluded orders stay NULL and resolve
-- to DEFAULT_PROFIT_SETTINGS at read time (mirrors the cost-snapshot NULL pattern).
-- Pure ADD COLUMN: no default, no constraint, no index → no INSERT-path behavior change.
-- orders already has org-scoped RLS; these row-agnostic columns need NO policy change.

ALTER TABLE "orders"
  ADD COLUMN "snapshot_include_stopaj" BOOLEAN,
  ADD COLUMN "snapshot_include_negative_net_vat" BOOLEAN;
