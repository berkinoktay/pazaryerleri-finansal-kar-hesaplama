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

-- ─── estimated_net_profit write-once GEVŞETİLDİ (2026-06-13) ───────────
-- PR-9'daki write-once kilidi KALDIRILDI. Gerekçe (design 2026-06-13 §5):
-- kargo bedeli fatura çıkana kadar bir TAHMİNDİR ve daha iyi bilgi geldikçe
-- rafine olur (T+0 ürün-desi → kargoya verilince cargoDeci). Bu yüzden
-- estimated_net_profit ("tahmini kâr") GÜNCELLENEBİLİR olmalı.
--
-- MALİYET-DONDURMA korunur: order_items snapshot immutability (yukarıdaki
-- reject_snapshot_update) maliyetin değişmezliğini garanti eder; estimate
-- recompute her zaman donmuş maliyeti kullanır. EXCLUDED sipariş donması da
-- korunur (aşağıdaki reject_profit_freeze_breach — kâr-dışı siparişte iki
-- kâr kolonu da donuk kalır).
DROP TRIGGER IF EXISTS orders_estimated_net_profit_write_once ON orders;
DROP FUNCTION IF EXISTS public.reject_estimated_net_profit_update();
-- KABUL EDİLEN ZAYIFLAMA (review M1): write-once gidince "hesaplanmış sipariş
-- kâr-dışına çekilemez" garantisi (reject_profit_freeze_breach ELSIF, aşağıda)
-- yalnız OLD.estimated_net_profit NOT NULL iken tutuyor. Teorik 2-UPDATE açığı:
-- estimate'i NULL'la → sonra exclude et. App kodundan ULAŞILMAZ: tek NULL'layan
-- check-constraints.sql'deki dedup-repair (rn>1 yinelenenler, re-entry yeniden
-- yazar); estimate yazan tek yol non-null yazar + profitExcludedAt'te erken döner;
-- exclusion yalnız CREATE'te damgalanır. Estimate write-many olduğundan saf
-- write-once trigger geri konamaz; garanti app-katmanı disipliniyle korunuyor.

-- ─── reject_profit_freeze_breach ───────────────────────────────────────
-- Calculated-or-excluded sözleşmesinin (spec 2026-06-12 §3) DB bekçisi.
-- Kâr-dışı (profit_excluded_at NOT NULL) sipariş: estimate/settled kâr
-- yazımı, damganın silinmesi/değişmesi yasak. Hesaplanmış sipariş kâr-dışına
-- çekilemez. Status/kargo gibi diğer kolonlar serbest. Not SECURITY DEFINER:
-- görevi reddetmek, yetki aşmak değil (reject_snapshot_update ile aynı).
CREATE OR REPLACE FUNCTION public.reject_profit_freeze_breach()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.profit_excluded_at IS NOT NULL THEN
    IF NEW.estimated_net_profit IS DISTINCT FROM OLD.estimated_net_profit THEN
      RAISE EXCEPTION 'profit-excluded order: estimated_net_profit is frozen'
        USING ERRCODE = '42501',
              HINT = 'Cost window closed at end of order day; exclusion is permanent.';
    END IF;
    IF NEW.settled_net_profit IS DISTINCT FROM OLD.settled_net_profit THEN
      RAISE EXCEPTION 'profit-excluded order: settled_net_profit is frozen'
        USING ERRCODE = '42501',
              HINT = 'Excluded orders never enter profit aggregates (decision K1).';
    END IF;
    -- Net KDV kolonları da kâr kolonlarıyla aynı dondurma sözleşmesine tabi
    -- (2026-06-15): kâr-dışı siparişte estimated/settled net_vat de donuk kalır.
    IF NEW.estimated_net_vat IS DISTINCT FROM OLD.estimated_net_vat THEN
      RAISE EXCEPTION 'profit-excluded order: estimated_net_vat is frozen'
        USING ERRCODE = '42501',
              HINT = 'Net VAT follows the profit-freeze contract (display-only, never re-derived).';
    END IF;
    IF NEW.settled_net_vat IS DISTINCT FROM OLD.settled_net_vat THEN
      RAISE EXCEPTION 'profit-excluded order: settled_net_vat is frozen'
        USING ERRCODE = '42501',
              HINT = 'Net VAT follows the profit-freeze contract (display-only, never re-derived).';
    END IF;
    IF NEW.profit_excluded_at IS DISTINCT FROM OLD.profit_excluded_at
       OR NEW.profit_exclusion_reason IS DISTINCT FROM OLD.profit_exclusion_reason THEN
      RAISE EXCEPTION 'profit exclusion is permanent'
        USING ERRCODE = '42501',
              HINT = 'Exclusion cannot be cleared or rewritten.';
    END IF;
  ELSIF NEW.profit_excluded_at IS NOT NULL AND OLD.estimated_net_profit IS NOT NULL THEN
    RAISE EXCEPTION 'calculated order cannot be excluded'
      USING ERRCODE = '42501',
            HINT = 'Calculated profit already in aggregates; excluding would rewrite history.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_profit_freeze_breach ON orders;
CREATE TRIGGER trg_reject_profit_freeze_breach
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_profit_freeze_breach();
