/**
 * Golden integration test for buildStatementBreakdown (Phase 4A, Gorev 3). It proves
 * the breakdown built from the stored best-known statement row plus the loaded lines
 * is identical, to the kurus, to the one built from a fresh in-request computation --
 * and that both close the four display groups to the sale. Runs against the isolated
 * test database on the golden melontik parcel, with a settlement record so the
 * best-known view diverges from the estimate (it selects the marketplace actuals).
 *
 * Requires: `supabase start` + `pnpm db:push` before running.
 */

import { Decimal } from 'decimal.js';
import { prisma } from '@pazarsync/db';
import { ProfitLineSource, ProfitStatementView } from '@pazarsync/db/enums';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type ProfitLine } from '../../core/profit-line';
import { selectLines } from '../../core/select-lines';
import {
  buildStatementBreakdown,
  STORED_STATEMENT_TOTALS_SELECT,
  statementTotalsFromRow,
  statementTotalsFromStatement,
  type StatementBreakdown,
} from '../../read/statement-breakdown';
import { loadOrderProfitLines } from '../../read/load-order-profit-lines';
import { computeParcelProfit, type ComputedParcelProfit } from '../compute-parcel-profit';
import { recomputeParcelProfit } from '../recompute-parcel-profit';
import {
  ensureDbReachable,
  insertFinanceRecord,
  melontikSaleCycleRecordInputs,
  seedMelontikParcel,
  truncateAll,
  type MelontikParcel,
} from './helpers/melontik-parcel';

/** Runs the writer in its own transaction with a generous lock-wait budget. */
function runWriter(organizationId: string, orderId: string): Promise<void> {
  return prisma.$transaction(
    async (tx) => {
      await recomputeParcelProfit(tx, { organizationId, orderId });
    },
    { maxWait: 15000, timeout: 30000 },
  );
}

/** Runs the read-only computation in its own transaction. */
function compute(organizationId: string, orderId: string): Promise<ComputedParcelProfit> {
  return prisma.$transaction((tx) => computeParcelProfit(tx, { organizationId, orderId }), {
    maxWait: 15000,
    timeout: 30000,
  });
}

/** Loads the stored lines of one order in one transaction. */
function loadLines(parcel: MelontikParcel): Promise<ReadonlyMap<string, readonly ProfitLine[]>> {
  return prisma.$transaction((tx) =>
    loadOrderProfitLines(tx, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      orderIds: [parcel.orderId],
    }),
  );
}

/** The four display groups must close to the sale gross to the kurus. */
function expectClosesToSale(breakdown: StatementBreakdown): void {
  const sum = new Decimal(breakdown.costGross)
    .add(breakdown.marketplaceFeesGross)
    .add(breakdown.taxesGross)
    .add(breakdown.netProfit);
  expect(sum.toFixed(2)).toBe(breakdown.saleGross);
}

describe('statement breakdown golden', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('builds the same breakdown from stored rows as from a fresh computation', async () => {
    const parcel = await seedMelontikParcel();
    for (const record of melontikSaleCycleRecordInputs(parcel)) {
      await insertFinanceRecord(record);
    }
    await runWriter(parcel.organizationId, parcel.orderId);

    // Breakdown A: from the stored best-known row plus the loaded, view-selected lines.
    const storedRow = await prisma.orderProfitStatement.findFirst({
      where: { orderId: parcel.orderId, view: ProfitStatementView.BEST_KNOWN },
      select: STORED_STATEMENT_TOTALS_SELECT,
    });
    if (storedRow === null) {
      throw new Error('expected a stored best-known statement');
    }
    const loaded = loadLinesOrThrow(await loadLines(parcel), parcel.orderId);
    const breakdownA = buildStatementBreakdown({
      totals: statementTotalsFromRow(storedRow),
      selectedLines: selectLines(loaded, 'BEST_KNOWN'),
    });

    // Breakdown B: from the fresh in-request computation's best-known view.
    const computed = await compute(parcel.organizationId, parcel.orderId);
    const breakdownB = buildStatementBreakdown({
      totals: statementTotalsFromStatement(computed.bestKnown),
      selectedLines: computed.bestKnown.selectedLines,
    });

    if (breakdownA === null || breakdownB === null) {
      throw new Error('expected both breakdowns to be present');
    }
    expect(breakdownA).toEqual(breakdownB);
    expectClosesToSale(breakdownA);

    // The settled sale lines carry the list price and the seller discount, so the
    // best-known breakdown keeps the discount: list 529.00 + 409.68, discount
    // 37.72 + 29.21, sale 491.28 + 380.47.
    expect(breakdownA.listGross).toBe('938.68');
    expect(breakdownA.sellerDiscountGross).toBe('66.93');
    expect(breakdownA.saleGross).toBe('871.75');

    // The best-known view really did take the settlement actuals, so this is not a
    // trivial estimate-only parcel.
    expect(
      computed.bestKnown.selectedLines.some(
        (line) => line.source === ProfitLineSource.MARKETPLACE_RECORD,
      ),
    ).toBe(true);
  });
});

/** Pulls one order's lines out of the loader map, failing when the key is missing. */
function loadLinesOrThrow(
  byOrderId: ReadonlyMap<string, readonly ProfitLine[]>,
  orderId: string,
): readonly ProfitLine[] {
  const lines = byOrderId.get(orderId);
  if (lines === undefined) {
    throw new Error('expected the parcel order id in the loader map');
  }
  return lines;
}
