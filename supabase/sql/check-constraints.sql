-- DB-level invariants enforced via PostgreSQL CHECK constraints and
-- partial UNIQUE indexes. Applied by `pnpm db:apply-policies` after
-- `prisma db push`.
--
-- Prisma 7 does not have native syntax for CHECK constraints or partial
-- (WHERE-clause) unique indexes, so they live here separately from
-- schema.prisma. Some are mirrored into the migration that introduced them;
-- the rest exist only through this file, which the deploy step applies after
-- `prisma migrate deploy`.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS before ADD CONSTRAINT;
-- CREATE UNIQUE INDEX IF NOT EXISTS for partial uniques.

-- ─── GROSS konvansiyon: cost vat_rate nonneg (2026-06-16) ────────────────
-- GROSS convention'a geçildi: amount(net)+vatAmount → amountGross+vatRate.
-- vatRate oranı daima ≥ 0 (negatif KDV oranı imkânsız). Eski vat_amount_nonneg
-- constraint'leri GROSS refactor kapsamında kaldırıldı; vat_rate_nonneg aldı.

ALTER TABLE cost_profiles DROP CONSTRAINT IF EXISTS cost_profiles_vat_amount_nonneg;
ALTER TABLE cost_profiles DROP CONSTRAINT IF EXISTS cost_profiles_vat_rate_nonneg;
ALTER TABLE cost_profiles ADD CONSTRAINT cost_profiles_vat_rate_nonneg CHECK (vat_rate >= 0);

ALTER TABLE cost_profile_versions DROP CONSTRAINT IF EXISTS cost_profile_versions_vat_amount_nonneg;
ALTER TABLE cost_profile_versions DROP CONSTRAINT IF EXISTS cost_profile_versions_vat_rate_nonneg;
ALTER TABLE cost_profile_versions ADD CONSTRAINT cost_profile_versions_vat_rate_nonneg CHECK (vat_rate >= 0);

-- ─── variant-recovery PR-2: resolution kuyruğu partial index ───────────
-- Kuyruk sorgusu: product_variant_id IS NULL AND barcode IS NOT NULL AND
-- (next_resolution_at IS NULL OR <= now). Düz full-table index bu şekle
-- hizmet edemez; partial index çözülmemiş küçük kümeyi taşır. Şemadaki eski
-- düz sürümün kalıntısına karşı önce DROP (idempotent geçiş).
-- Mirror: prisma/migrations/20260612020000.
DROP INDEX IF EXISTS order_items_resolution_due_idx;
CREATE INDEX order_items_resolution_due_idx
  ON order_items (next_resolution_at)
  WHERE product_variant_id IS NULL AND barcode IS NOT NULL;

-- ─── order_items dedup: defense-in-depth partial UNIQUE (2026-07-12) ────
-- OrderItem dedup is enforced today only at the application layer: the upsert
-- does a platform_line_id-first findFirst before inserting, and concurrent
-- double-processing is structurally impossible (one sync job holds the store's
-- active-slot lease; one webhook_event holds the processing lease). This
-- partial UNIQUE is the DB-layer safety belt against a future bug that slips
-- past both -- two rows for the same (order, line) would double-count revenue
-- and profit, which this index makes impossible. If a P2002 ever fires from
-- here it lands in intake's transient class: the event is retried with backoff
-- and the next replay's findFirst sees the existing row and skips (self-
-- healing). platform_line_id NULL (legacy / unmapped) rows are deliberately out
-- of scope -- the same variant can legitimately span multiple such lines, so a
-- unique over NULLs would be wrong. Prisma 7 has no WHERE-clause unique syntax,
-- so it lives here + is registered in the worker's REQUIRED_INDEXES DDL
-- assertions (a db reset that skips supabase/sql must not silently drop it).
CREATE UNIQUE INDEX IF NOT EXISTS order_items_order_platform_line_uniq
  ON public.order_items (order_id, platform_line_id)
  WHERE platform_line_id IS NOT NULL;

-- ─── sync_logs claim-scan ordering index (tryClaimNext) ────────────────
-- Serves packages/sync-core/src/claim.ts::tryClaimNext, whose hot path is
--   SELECT id FROM sync_logs
--    WHERE status IN ('PENDING','FAILED_RETRYABLE') AND ...
--    ORDER BY COALESCE(next_attempt_at, started_at)
--    FOR UPDATE SKIP LOCKED LIMIT 1
-- run once per poll tick by every worker in the pool. A partial expression
-- index over the same COALESCE expression, restricted to the two claimable
-- statuses, lets Postgres walk straight to the next-ready row instead of a
-- full scan + sort of the whole (mostly-terminal) sync_logs table as the
-- queue grows. The runtime-only predicates (attempt_count < MAX,
-- started_at <= now()) can't live in the index (now() is not immutable), so
-- they filter the already-narrow partial scan.
--
-- Performance ONLY — deliberately NOT a boot invariant. It is intentionally
-- absent from the worker's REQUIRED_INDEXES DDL assertions
-- (apps/sync-worker/src/lib/ddl-assertions.ts), which guard the
-- correctness-critical partial UNIQUE indexes (duplicate-job / order-line
-- dedup): a missing performance index degrades claim speed, never
-- correctness, so failing boot over it would be wrong.
CREATE INDEX IF NOT EXISTS sync_logs_claim_order_idx
  ON sync_logs ((COALESCE(next_attempt_at, started_at)))
  WHERE status IN ('PENDING', 'FAILED_RETRYABLE');

-- catalog_barcode_miss indexes are owned by the Prisma schema, not this script.
-- schema.prisma declares @@unique([storeId, barcode]) and @@index([storeId,
-- nextRetryAt]) on CatalogBarcodeMiss; the Prisma migrations (0_init baseline)
-- create them under Prisma's default names:
--   catalog_barcode_miss_store_id_barcode_key        (UNIQUE store_id, barcode)
--   catalog_barcode_miss_store_id_next_retry_at_idx  (store_id, next_retry_at)
-- Do NOT recreate them here. Earlier CREATE INDEX IF NOT EXISTS statements under
-- different custom names (catalog_barcode_miss_store_barcode_uniq /
-- catalog_barcode_miss_store_retry_idx) produced duplicate indexes over the same
-- columns, dropped with the 2026-07-08 migration-history baseline. Unlike the
-- partial (WHERE-clause) uniques above, these are plain indexes Prisma owns.

-- ─── Paket D: webhook_events ingest-queue scan index ───────────────────
-- webhook_events doubles as a durable ingest queue: the consumer tick in
-- apps/sync-worker (webhook-events-consumer) scans for outstanding work with
--   SELECT id FROM webhook_events
--    WHERE processed_at IS NULL
--      AND (next_process_at IS NULL OR next_process_at <= now())
--    ORDER BY received_at ASC LIMIT <batch>
-- every few seconds. The overwhelming majority of rows are terminal
-- (processed_at IS NOT NULL) and must never be walked; a PARTIAL index over
-- received_at restricted to the unprocessed set keeps that scan on the small
-- live tail instead of the ever-growing audit log. The now()-based
-- next_process_at predicate can't live in the index (now() is not immutable),
-- so it filters the already-narrow partial scan. Prisma 7 has no WHERE-clause
-- index syntax, so it lives here + is registered in the worker's
-- REQUIRED_INDEXES DDL assertions (a db reset that skips supabase/sql must not
-- silently drop the queue's scan support). Mirror it into the introducing
-- migration for prod `prisma migrate deploy`.
CREATE INDEX IF NOT EXISTS webhook_events_unprocessed_idx
  ON webhook_events (received_at)
  WHERE processed_at IS NULL;

-- ─── phase 3D: profit stale-sweep NOT EXISTS probe ────────────────────
-- The profit recompute tick's idle stale sweep (packages/profit
-- enqueueStaleProfitStatements) finds orders missing a current best-known
-- statement with
--   NOT EXISTS (SELECT 1 FROM order_profit_statements s
--               WHERE s.order_id = o.id
--                 AND s.view = 'BEST_KNOWN'
--                 AND s.engine_version >= <PROFIT_ENGINE_VERSION>)
-- A partial index over (order_id, engine_version) restricted to the
-- BEST_KNOWN view lets that probe answer from the index alone, one lookup
-- per candidate order, instead of scanning the statement heap. Prisma 7 has
-- no WHERE-clause index syntax, so it lives here and is applied by
-- apply-policies alongside the other partial indexes above.
CREATE INDEX IF NOT EXISTS order_profit_statements_best_known_idx
  ON order_profit_statements (order_id, engine_version)
  WHERE view = 'BEST_KNOWN';

-- ─── 2026-06-12 profit-freeze: calculated-or-excluded ──────────────────
-- Tombstone (design 2026-10-29 §8.3): exclusion is no longer permanent and a
-- calculated order may be excluded, so the xor check is dropped here and on any
-- database that still carries it. The pair check below stays.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_profit_freeze_xor_check;

-- Çift kolon tutarlılığı: damga ve gerekçe birlikte yaşar.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_profit_exclusion_pair_check;
ALTER TABLE orders ADD CONSTRAINT orders_profit_exclusion_pair_check
  CHECK ((profit_excluded_at IS NULL) = (profit_exclusion_reason IS NULL));

-- ─── desi nonneg (2026-06-13; NULL = no desi since 2026-11-22) ──────────
-- No desi may go below 0 (a negative desi is impossible). Both columns are
-- nullable and NULL passes the check: a NULL synced_dimensional_weight means the
-- marketplace sent no desi, a NULL dimensional_weight_override means no seller
-- override, and both NULL means the variant has no desi; 0 is a real desi. The
-- synced column keeps its default 0 (migration nullable_synced_desi). The
-- constraint was renamed together with the column; the legacy name is dropped
-- too, because Postgres
-- keeps a constraint's name on RENAME COLUMN, so a DB that got only the column
-- rename would otherwise keep a duplicate under the old name.
-- Mirror: prisma/migrations/20261028163120_rename_dimensional_weight_override.
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_dimensional_weight_nonneg_check;
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_dimensional_weight_override_nonneg_check;
ALTER TABLE product_variants ADD CONSTRAINT product_variants_dimensional_weight_override_nonneg_check
  CHECK (synced_dimensional_weight >= 0 AND (dimensional_weight_override IS NULL OR dimensional_weight_override >= 0));
