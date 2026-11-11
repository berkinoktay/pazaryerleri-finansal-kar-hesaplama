-- Data-only migration: no schema diff, so `prisma migrate dev` creates nothing.
-- Exclusion is no longer permanent (design 2026-10-29 profit-engine section 8.3) and
-- the automatic exclusion was removed in phase 3B. This migration retires the
-- freeze contract and clears the legacy automatic exclusions.
--
-- The trigger and xor check are dropped BEFORE the UPDATE: the old freeze
-- trigger rejects clearing an exclusion stamp ("profit exclusion is permanent"),
-- so the UPDATE below would fail while it is still attached. Dropping is safe to
-- re-run (IF EXISTS); the governance SQL (triggers.sql / check-constraints.sql)
-- carries the same tombstones for environments applied via db:push.
DROP TRIGGER IF EXISTS trg_reject_profit_freeze_breach ON "orders";
DROP FUNCTION IF EXISTS public.reject_profit_freeze_breach();
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS orders_profit_freeze_xor_check;
UPDATE "orders" SET "profit_excluded_at" = NULL, "profit_exclusion_reason" = NULL
WHERE "profit_exclusion_reason" IN ('COST_DEADLINE_MISSED', 'LATE_UNCOSTED_ARRIVAL', 'LEGACY_BACKFILL');
