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

-- ─── order_items cost snapshot write-once (tombstone) ─────────────────
-- The unit_cost_snapshot_* columns and their write-once trigger were dropped in
-- phase 5 of the profit-engine rebuild (migration 20261111104912); the engine
-- reads cost profile versions directly. These lines clear the trigger and its
-- function on a database that still carries them.
DROP TRIGGER IF EXISTS order_items_snapshot_immutable ON order_items;
DROP FUNCTION IF EXISTS public.reject_snapshot_update();

-- ─── estimated_net_profit write-once GEVŞETİLDİ (2026-06-13) ───────────
-- PR-9'daki write-once kilidi KALDIRILDI. Gerekçe (design 2026-06-13 §5):
-- kargo bedeli fatura çıkana kadar bir TAHMİNDİR ve daha iyi bilgi geldikçe
-- rafine olur (T+0 ürün-desi → kargoya verilince cargoDeci). Bu yüzden
-- estimated_net_profit ("tahmini kâr") GÜNCELLENEBİLİR olmalı.
--
-- The estimated_net_profit column itself was dropped in phase 5 of the
-- profit-engine rebuild (migration 20261111104912).
DROP TRIGGER IF EXISTS orders_estimated_net_profit_write_once ON orders;
DROP FUNCTION IF EXISTS public.reject_estimated_net_profit_update();

-- ─── reject_profit_freeze_breach (tombstone) ───────────────────────────
-- The old freeze trigger made exclusion a one-way door AND froze the legacy
-- profit columns of an excluded order. It was dropped in phase 3D (design
-- 2026-10-29 section 8.3). These lines drop the trigger and its function on
-- databases that still carry them. The narrower permanence guard below
-- (reject_automatic_exclusion_change) replaces only its exclusion half --
-- Berkin reversed the "exclusion is not permanent" reading on 2026-11-03.
DROP TRIGGER IF EXISTS trg_reject_profit_freeze_breach ON orders;
DROP FUNCTION IF EXISTS public.reject_profit_freeze_breach();

-- --- reject_automatic_exclusion_change ---------------------------------
-- Berkin's rule (2026-11-03): an order whose cost missed its order day must
-- stay out of profit PERMANENTLY. Supply prices drift, so a cost entered after
-- the day is no longer that day's cost and must never pull the order back into
-- any net-profit figure. Berkin extended it to the product desi on 2026-11-22
-- (plan PR-2c): an order whose desi was still missing when its day closed, or
-- when it arrived from a past day, stays out of profit permanently too, even if
-- a desi or a cargo invoice arrives later. Once an order carries an AUTOMATIC
-- exclusion reason it can never be un-excluded or re-pointed at another reason.
--
-- The guard covers ONLY the automatic reasons -- COST_DEADLINE_MISSED (the
-- day-end buffer flush), LATE_UNCOSTED_ARRIVAL (a past-day order that arrived
-- uncosted), their desi counterparts DESI_DEADLINE_MISSED and
-- LATE_DESILESS_ARRIVAL, and LEGACY_BACKFILL (the old 2026-06-12 profit-freeze
-- backfill; no writer stamps it today, it is listed defensively). A future
-- user-chosen exclusion is meant to be reversible and will carry its own
-- distinct reason, so it is deliberately left out of this list. Stamping an
-- exclusion on an order that currently has none stays allowed, because OLD's
-- reason is then NULL (not one of the automatic reasons): the two writers and
-- the backfill script rely on that, and the pair check still forces the stamp
-- and its reason to be written together.
--
-- Not SECURITY DEFINER: its only job is to deny, so it runs with the UPDATE
-- caller's privileges, never as postgres.
CREATE OR REPLACE FUNCTION public.reject_automatic_exclusion_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.profit_exclusion_reason IN (
       'COST_DEADLINE_MISSED',
       'LATE_UNCOSTED_ARRIVAL',
       'DESI_DEADLINE_MISSED',
       'LATE_DESILESS_ARRIVAL',
       'LEGACY_BACKFILL'
     )
     AND (NEW.profit_excluded_at IS DISTINCT FROM OLD.profit_excluded_at
          OR NEW.profit_exclusion_reason IS DISTINCT FROM OLD.profit_exclusion_reason) THEN
    RAISE EXCEPTION 'automatic profit exclusion is permanent'
      USING ERRCODE = '42501',
            HINT = 'An automatic profit exclusion (cost or desi missed the order day) can never be cleared or re-pointed.';
  END IF;
  RETURN NEW;
END;
$$;

-- BEFORE UPDATE OF keeps every unrelated order update (status, cargo progress,
-- estimate refinement) from running this at all. Postgres fires a column-scoped
-- trigger whenever any listed column appears in the UPDATE's SET list -- exactly
-- the writes that could tamper with an automatic stamp -- regardless of whether
-- the value actually changes; the IS DISTINCT FROM checks inside do the real
-- gating so an idempotent re-stamp of the same values still passes.
DROP TRIGGER IF EXISTS trg_reject_automatic_exclusion_change ON orders;
CREATE TRIGGER trg_reject_automatic_exclusion_change
  BEFORE UPDATE OF profit_excluded_at, profit_exclusion_reason ON orders
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_automatic_exclusion_change();

-- --- Seller-input history (same-day edit window) ----------------------------
-- Berkin's rule (2026-11-23): an order's cost links and desi are the values in
-- force at the end of its Istanbul business day. Changes during the day reach
-- every order of that day; at 00:00 the seller inputs become final. Rebuilding
-- the state at a day end needs what a hard delete or an in-place overwrite
-- would lose, so two append-only logs keep it.
--
-- Every stamp is timezone('utc'::text, now()): the start instant of the writing
-- transaction as a UTC wall clock (the stamp columns are TIMESTAMP(3) without
-- time zone, so a bare now() would follow the session time zone). It is the same
-- expression as the attached_at / effective_from column defaults, so a replace
-- (delete the old link, attach the new one, write a version) in one transaction
-- carries one instant everywhere.
--
-- Neither function is SECURITY DEFINER: they run with the caller's privileges.
-- The API and the worker write as the service role; `authenticated` has no write
-- policy on product_variant_cost_profiles or product_variants, so it can never
-- fire them.

-- One-shot final-marker backfill for a database that got this schema without
-- the migration's own backfill (20261123175419_seller_input_history): `pnpm
-- db:push`, or `prisma migrate resolve --applied`. Orders dated before today's
-- Istanbul start had their link detaches and desi edits logged by nobody, so they
-- must be final, or the day-close pass would re-derive (and possibly stamp) the
-- whole history. It runs only while trg_log_cost_link_removal does not exist yet,
-- i.e. once, on the run that first installs the history triggers below, and it
-- only touches non-final orders: on the db:deploy path the migration already
-- marked them, so it changes no row. The boundary and the stamp are the
-- migration's own expressions (order_date is a UTC wall clock: Istanbul local
-- midnight -> the instant -> its UTC wall clock); neither follows the session
-- time zone. Must stay before the DROP TRIGGER of trg_log_cost_link_removal.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger
     WHERE tgname = 'trg_log_cost_link_removal'
       AND tgrelid = 'public.product_variant_cost_profiles'::regclass
  ) THEN
    UPDATE public.orders
       SET seller_inputs_final_at = timezone('utc'::text, now())
     WHERE order_date < ((date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul')
                          AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'UTC')
       AND seller_inputs_final_at IS NULL;
  END IF;
END
$$;

-- log_cost_link_removal: one cost_link_removals row per DIRECT delete of a cost
-- link (a detach or the delete half of a replace). The removed link's own
-- attached_at is kept, so the link can be rebuilt for any day end between its
-- attach and its detach.
CREATE OR REPLACE FUNCTION public.log_cost_link_removal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.cost_link_removals
    (organization_id, product_variant_id, profile_id, attached_at, detached_at)
  VALUES
    (OLD.organization_id, OLD.product_variant_id, OLD.profile_id, OLD.attached_at,
     timezone('utc'::text, now()));
  RETURN OLD;
END;
$$;

-- Direct deletes only. A delete cascaded from a deleted variant, cost profile,
-- store or organization runs inside the foreign key's own trigger, at depth 1,
-- and is not logged: the variant or profile is gone for good, and an
-- organization delete would otherwise insert a row that references the
-- organization being deleted. WHEN is evaluated when the row is deleted, so the
-- depth is the deleting statement's own.
DROP TRIGGER IF EXISTS trg_log_cost_link_removal ON product_variant_cost_profiles;
CREATE TRIGGER trg_log_cost_link_removal
  AFTER DELETE ON product_variant_cost_profiles
  FOR EACH ROW
  WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION public.log_cost_link_removal();

-- log_variant_desi_change: one variant_desi_changes row per real change of
-- either desi column (the seller override or the synced marketplace value),
-- with the old and new values of both columns and which of them changed. seq
-- (bigserial) is the application order: writes to one variant row wait on its
-- row lock, so they take their seq in commit order.
CREATE OR REPLACE FUNCTION public.log_variant_desi_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.variant_desi_changes
    (organization_id, store_id, product_variant_id, changed_at,
     override_changed, synced_changed, old_override, new_override, old_synced, new_synced)
  VALUES
    (NEW.organization_id, NEW.store_id, NEW.id, timezone('utc'::text, now()),
     OLD.dimensional_weight_override IS DISTINCT FROM NEW.dimensional_weight_override,
     OLD.synced_dimensional_weight IS DISTINCT FROM NEW.synced_dimensional_weight,
     OLD.dimensional_weight_override, NEW.dimensional_weight_override,
     OLD.synced_dimensional_weight, NEW.synced_dimensional_weight);
  RETURN NEW;
END;
$$;

-- UPDATE OF keeps every unrelated variant update (price, stock, status) from
-- evaluating the trigger at all; the WHEN clause then skips a write that names
-- a desi column but keeps its value, so only real changes are logged.
DROP TRIGGER IF EXISTS trg_log_variant_desi_change ON product_variants;
CREATE TRIGGER trg_log_variant_desi_change
  AFTER UPDATE OF dimensional_weight_override, synced_dimensional_weight ON product_variants
  FOR EACH ROW
  WHEN (OLD.dimensional_weight_override IS DISTINCT FROM NEW.dimensional_weight_override
        OR OLD.synced_dimensional_weight IS DISTINCT FROM NEW.synced_dimensional_weight)
  EXECUTE FUNCTION public.log_variant_desi_change();
