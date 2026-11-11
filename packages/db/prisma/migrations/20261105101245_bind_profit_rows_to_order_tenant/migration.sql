-- Bind every profit row to its order's tenant (Phase 4C, Gorev 2).
--
-- profit_lines and order_profit_statements each replace their single-column
-- order_id foreign key with a composite key on (order_id, organization_id,
-- store_id) that references the new orders unique key on the same triple. A
-- profit row whose organization_id/store_id differs from its order's is now
-- rejected by Postgres -- defense in depth for the absolute tenant-isolation
-- invariant, on top of the application org/store filters and RLS.
--
-- Lock impact: each ADD CONSTRAINT ... FOREIGN KEY below validates the child
-- table's existing rows, holding a SHARE ROW EXCLUSIVE lock on both the child
-- (profit_lines / order_profit_statements) and the parent (orders) for the scan.
-- At pre-launch sizes (hundreds of orders, low thousands of profit rows) this is
-- a sub-second lock, so the one-step ADD CONSTRAINT is used directly. For a large
-- production table the two-step ADD CONSTRAINT ... NOT VALID (brief lock) +
-- VALIDATE CONSTRAINT (no table-rewrite, weaker lock) would replace it; it is not
-- warranted here. CREATE UNIQUE INDEX on orders covers the primary-key column
-- plus two more, so it can never find a duplicate and is likewise brief.

-- DropForeignKey
ALTER TABLE "order_profit_statements" DROP CONSTRAINT "order_profit_statements_order_id_fkey";

-- DropForeignKey
ALTER TABLE "profit_lines" DROP CONSTRAINT "profit_lines_order_id_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "orders_id_organization_id_store_id_key" ON "orders"("id", "organization_id", "store_id");

-- Guard: before the composite foreign keys validate, fail loudly if any existing
-- profit row already breaks the invariant. A bare FK-validation error would not
-- report how many rows or which table; this names both counts. The dev data check
-- ran clean (0 mismatching rows) on 2026-11-05 -- this is the gate for every other
-- environment the migration is replayed against.
DO $$
DECLARE
  line_mismatches integer;
  statement_mismatches integer;
BEGIN
  SELECT count(*) INTO line_mismatches
    FROM "profit_lines" pl
    JOIN "orders" o ON o.id = pl.order_id
   WHERE pl.organization_id <> o.organization_id OR pl.store_id <> o.store_id;

  SELECT count(*) INTO statement_mismatches
    FROM "order_profit_statements" s
    JOIN "orders" o ON o.id = s.order_id
   WHERE s.organization_id <> o.organization_id OR s.store_id <> o.store_id;

  IF line_mismatches > 0 OR statement_mismatches > 0 THEN
    RAISE EXCEPTION
      'Cannot bind profit rows to their order tenant: % profit_lines and % order_profit_statements have an organization_id/store_id differing from their order. Reconcile these rows before applying this migration.',
      line_mismatches, statement_mismatches;
  END IF;
END $$;

-- AddForeignKey
ALTER TABLE "profit_lines" ADD CONSTRAINT "profit_lines_order_id_organization_id_store_id_fkey" FOREIGN KEY ("order_id", "organization_id", "store_id") REFERENCES "orders"("id", "organization_id", "store_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_profit_statements" ADD CONSTRAINT "order_profit_statements_order_id_organization_id_store_id_fkey" FOREIGN KEY ("order_id", "organization_id", "store_id") REFERENCES "orders"("id", "organization_id", "store_id") ON DELETE CASCADE ON UPDATE CASCADE;
