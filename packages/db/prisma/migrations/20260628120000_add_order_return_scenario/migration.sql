-- Deterministic "if fully returned" profit scenario, stored on the order.
-- Written by applyEstimateOnOrderCreate alongside estimated_net_profit; nullable
-- (no default) — historical / profit-excluded / already-returned orders stay NULL
-- and read as "no scenario". Pure ADD COLUMN: no default, no constraint, no index
-- → no INSERT-path behavior change. orders already has org-scoped RLS; row-agnostic
-- columns need no policy change.
ALTER TABLE "orders"
  ADD COLUMN "estimated_return_scenario_net_profit" DECIMAL(12,2),
  ADD COLUMN "estimated_return_scenario_margin_pct" DECIMAL(8,4);
