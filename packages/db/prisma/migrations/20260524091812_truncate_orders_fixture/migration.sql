-- PR-A (2026-05-24): Order sync refactor — cost-driven storage discipline.
-- Spec: docs/superpowers/specs/2026-05-24-order-sync-refactor-design.md §5.1
--
-- Wipes existing dev fixture orders so the new forward-only cutoff (PR-A) and
-- calculability gate (PR-B) build clean state. The full order tree is removed.
--
-- Scope notes (verified against schema FK graph):
--   - sync_logs is intentionally PRESERVED (audit trail; no FK to orders).
--   - settlement_items.order_id is a SOFT reference (no FK constraint), so
--     settlements/settlement_items are NOT affected by the cascade.
--   - order_item_cost_snapshot_components is a child of order_items; it is
--     listed explicitly rather than left to implicit CASCADE.
--
-- Idempotent — TRUNCATE on empty tables is a no-op. All these tables use UUID
-- primary keys, so RESTART IDENTITY is a harmless no-op (kept for parity).

TRUNCATE TABLE
  order_claim_items,
  order_claims,
  order_fees,
  order_item_cost_snapshot_components,
  order_items,
  orders
RESTART IDENTITY CASCADE;
