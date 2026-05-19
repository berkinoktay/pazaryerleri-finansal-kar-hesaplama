-- DB-level invariants enforced via PostgreSQL CHECK constraints.
-- Applied by `pnpm db:apply-policies` after `prisma db push`.
--
-- Prisma 7 does not have native syntax for CHECK constraints, so they
-- live here separately from schema.prisma. Production deployment via
-- `prisma migrate deploy` picks them up from the matching migration.sql
-- (each constraint is mirrored to its introducing migration file).
--
-- Idempotent: DROP CONSTRAINT IF EXISTS before ADD CONSTRAINT.

-- ─── order_items: refunded ≤ gross commission ──────────────────────────
-- Effective commission = gross − refunded (research §3.2, design §3.2 +
-- §10.1 unit testler). Refunded > gross olursa Trendyol mapping hatası
-- veya Discount Sale'den önce işlenmiş demektir → fırlat ve Sentry'ye
-- alert. Schema'da @default(0) olduğu için boş satırlar tutarlı (0 ≤ 0).
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_refunded_commission_check;
ALTER TABLE order_items ADD CONSTRAINT order_items_refunded_commission_check
  CHECK (refunded_commission_amount_net <= gross_commission_amount_net);
