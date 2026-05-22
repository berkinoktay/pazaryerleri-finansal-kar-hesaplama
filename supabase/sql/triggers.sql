-- Database triggers for auto-provisioning per-user rows.
-- Applied after Prisma's `db push` via `pnpm db:apply-policies`
-- (same script, loops over a list of SQL files).
--
-- Design principles:
--   - SECURITY DEFINER runs the function body as its owner (postgres),
--     which can INSERT into public.user_profiles regardless of the RLS
--     policies on that table. The caller (auth.users INSERT) is the
--     anonymous Supabase Auth signup path and has no rights on public.
--   - Idempotent: ON CONFLICT DO NOTHING + DROP TRIGGER IF EXISTS so
--     re-running apply-policies never errors.
--   - The trigger only supplies `id` and `email`; `timezone` and
--     `preferred_language` use column defaults (Europe/Istanbul, tr).

-- ─── handle_new_user ───────────────────────────────────────────────────
-- Fires AFTER INSERT on auth.users so the row is committed before we
-- reference its id. The new user never sees the gap — the profile row
-- is live by the time they hit any app screen.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- updated_at is NOT NULL with no DB default (Prisma manages it via
  -- @updatedAt, which only fires from the ORM). Any non-Prisma INSERT
  -- — this trigger included — has to populate it explicitly. created_at
  -- has a DB DEFAULT now() from Prisma's @default(now()); timezone and
  -- preferred_language also use column defaults ('Europe/Istanbul', 'tr').
  INSERT INTO public.user_profiles (id, email, updated_at)
  VALUES (NEW.id, NEW.email, now())
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ─── reject_snapshot_update ────────────────────────────────────────────
-- Enforces write-once semantics on order_items snapshot columns. Once
-- these fields transition from NULL to a value at order arrival
-- (cost-snapshot.service.ts captures them in the same transaction as
-- the OrderItem INSERT), they are frozen forever — any subsequent
-- UPDATE that would change them is rejected with SQLSTATE 42501. This
-- is the load-bearing safety net for the spec's "past calculations
-- remain unaltered" rule (cost-profiles spec §5.7); app-layer guards
-- in the snapshot service can be bypassed by future code, the trigger
-- catches every path including raw SQL, migrations, and seeds.
--
-- Guarded columns (PR-6 continuation, 2026-05-21 — KDV-split native):
--   - unit_cost_snapshot          (legacy, scheduled for DROP at PR-8+)
--   - unit_cost_snapshot_net      (NET aggregate in TRY)
--   - unit_cost_snapshot_vat_amount (VAT aggregate in TRY)
--   - unit_cost_snapshot_vat_rate (effective denormalized rate)
--   - snapshot_captured_at        (capture timestamp)
--
-- Not SECURITY DEFINER: the trigger needs to run with the privileges
-- of the UPDATE caller, not as postgres — its job is to deny, not to
-- bypass authorization.
CREATE OR REPLACE FUNCTION public.reject_snapshot_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.unit_cost_snapshot IS NOT NULL AND
     NEW.unit_cost_snapshot IS DISTINCT FROM OLD.unit_cost_snapshot THEN
    RAISE EXCEPTION 'unit_cost_snapshot is write-once'
      USING ERRCODE = '42501',
            HINT = 'Past order calculations are immutable by design.';
  END IF;
  IF OLD.unit_cost_snapshot_net IS NOT NULL AND
     NEW.unit_cost_snapshot_net IS DISTINCT FROM OLD.unit_cost_snapshot_net THEN
    RAISE EXCEPTION 'unit_cost_snapshot_net is write-once'
      USING ERRCODE = '42501',
            HINT = 'Past order calculations are immutable by design.';
  END IF;
  IF OLD.unit_cost_snapshot_vat_amount IS NOT NULL AND
     NEW.unit_cost_snapshot_vat_amount IS DISTINCT FROM OLD.unit_cost_snapshot_vat_amount THEN
    RAISE EXCEPTION 'unit_cost_snapshot_vat_amount is write-once'
      USING ERRCODE = '42501',
            HINT = 'Past order calculations are immutable by design.';
  END IF;
  IF OLD.unit_cost_snapshot_vat_rate IS NOT NULL AND
     NEW.unit_cost_snapshot_vat_rate IS DISTINCT FROM OLD.unit_cost_snapshot_vat_rate THEN
    RAISE EXCEPTION 'unit_cost_snapshot_vat_rate is write-once'
      USING ERRCODE = '42501',
            HINT = 'Past order calculations are immutable by design.';
  END IF;
  IF OLD.snapshot_captured_at IS NOT NULL AND
     NEW.snapshot_captured_at IS DISTINCT FROM OLD.snapshot_captured_at THEN
    RAISE EXCEPTION 'snapshot_captured_at is write-once'
      USING ERRCODE = '42501',
            HINT = 'Past order calculations are immutable by design.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_items_snapshot_immutable ON order_items;
CREATE TRIGGER order_items_snapshot_immutable
  BEFORE UPDATE ON order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_snapshot_update();

-- ─── reject_estimated_net_profit_update (PR-9 second half) ─────────────
-- Enforces write-once semantics on Order.estimated_net_profit. T+0 estimate
-- is captured by applyEstimateOnOrderCreate as part of the order arrival
-- transaction; once written, it must never be overwritten — settlements
-- reconcile by writing settled_net_profit instead (spec §3 / §8.3 line 1369).
--
-- IS DISTINCT FROM semantics:
--   null → value : allowed (first write; null IS DISTINCT FROM value = true,
--                  but OLD IS NOT NULL guard short-circuits before reject)
--   value → value: no-op UPDATE allowed (IS DISTINCT FROM = false)
--   value → different value: reject (42501)
--   value → null : reject (a write-once invariant means no unset either)
--   0 → value    : reject (0 is a value; null/value boundary is strict)
CREATE OR REPLACE FUNCTION public.reject_estimated_net_profit_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.estimated_net_profit IS NOT NULL AND
     NEW.estimated_net_profit IS DISTINCT FROM OLD.estimated_net_profit THEN
    RAISE EXCEPTION 'estimated_net_profit is write-once'
      USING ERRCODE = '42501',
            HINT = 'T+0 estimate is immutable; settlements update settled_net_profit instead.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_estimated_net_profit_write_once ON orders;
CREATE TRIGGER orders_estimated_net_profit_write_once
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_estimated_net_profit_update();
