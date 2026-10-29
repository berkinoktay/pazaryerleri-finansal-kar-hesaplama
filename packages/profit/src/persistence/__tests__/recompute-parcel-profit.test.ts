/**
 * Integration tests for recomputeParcelProfit (Phase 3A, Gorev 5). They run against
 * the isolated test database and reproduce the golden melontik parcel, so the
 * writer persists the same lines, allocations and statements the Phase 2A golden
 * test pins, idempotently and under the parcel lock.
 *
 * Requires: `supabase start` + `pnpm db:push` before running.
 */

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { prisma, type Prisma } from '@pazarsync/db';
import {
  ProfitIssueCode,
  ProfitLineLevel,
  ProfitLineType,
  ProfitStatementView,
  ProfitStatus,
} from '@pazarsync/db/enums';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { estimateTrendyolParcel } from '../../marketplaces/trendyol/estimate-parcel';
import { ParcelNotFoundError } from '../errors';
import { loadTrendyolParcel } from '../load-trendyol-parcel';
import { recomputeParcelProfit, type RecomputeParcelResult } from '../recompute-parcel-profit';
import {
  attachCostProfile,
  ensureDbReachable,
  insertFinanceRecord,
  insertFxRate,
  MELONTIK,
  melontikCargoInvoiceInput,
  melontikSaleCycleRecordInputs,
  seedMelontikParcel,
  truncateAll,
} from './helpers/melontik-parcel';

/** Runs one recompute in its own transaction, with a generous lock-wait budget. */
function recompute(organizationId: string, orderId: string): Promise<RecomputeParcelResult> {
  return prisma.$transaction((tx) => recomputeParcelProfit(tx, { organizationId, orderId }), {
    maxWait: 15000,
    timeout: 30000,
  });
}

/** The estimate line count for a parcel, loaded and estimated read-only. */
async function estimateLineCount(organizationId: string, orderId: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const loaded = await loadTrendyolParcel(tx, { organizationId, orderId });
    return estimateTrendyolParcel(loaded.estimateInput).lines.length;
  });
}

/** Reads one persisted statement view for a parcel, failing when it is missing. */
async function readStatement(
  orderId: string,
  view: ProfitStatementView,
): Promise<{ status: ProfitStatus; netProfit: Prisma.Decimal | null }> {
  const row = await prisma.orderProfitStatement.findFirst({ where: { orderId, view } });
  if (row === null) {
    throw new Error(`expected a ${view} statement`);
  }
  return { status: row.status, netProfit: row.netProfit };
}

/** Pulls the issue codes out of a persisted statement's JSON issues array. */
function issueCodesOf(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const codes: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      continue;
    }
    const code = entry['code'];
    if (typeof code === 'string') {
      codes.push(code);
    }
  }
  return codes;
}

describe('recomputeParcelProfit', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('writes the melontik parcel lines, allocations and both statements', async () => {
    const parcel = await seedMelontikParcel();
    const expectedLineCount = await estimateLineCount(parcel.organizationId, parcel.orderId);

    const result = await recompute(parcel.organizationId, parcel.orderId);
    expect(result.changed).toBe(true);
    expect(result.bestKnown.status).toBe(ProfitStatus.ESTIMATED);
    expect(result.bestKnown.netProfit?.toFixed(2)).toBe('191.79');

    const lines = await prisma.profitLine.findMany({ where: { orderId: parcel.orderId } });
    expect(lines).toHaveLength(expectedLineCount);
    expect(lines.every((line) => line.organizationId === parcel.organizationId)).toBe(true);
    expect(lines.every((line) => line.storeId === parcel.storeId)).toBe(true);

    const statements = await prisma.orderProfitStatement.findMany({
      where: { orderId: parcel.orderId },
      orderBy: { view: 'asc' },
    });
    expect(statements).toHaveLength(2);
    for (const statement of statements) {
      expect(statement.status).toBe(ProfitStatus.ESTIMATED);
      expect(statement.netProfit?.toFixed(2)).toBe('191.79');
      expect(statement.organizationId).toBe(parcel.organizationId);
      expect(statement.storeId).toBe(parcel.storeId);
    }

    const shippingLine = lines.find((line) => line.type === ProfitLineType.SHIPPING);
    if (shippingLine === undefined) {
      throw new Error('expected a SHIPPING line');
    }
    const allocations = await prisma.profitLineAllocation.findMany({
      where: { profitLineId: shippingLine.id },
      orderBy: { amountVat: 'desc' },
    });
    expect(allocations).toHaveLength(2);
    expect(allocations.map((share) => share.amountGross.toFixed(2))).toEqual(['49.17', '49.17']);
    expect(allocations.map((share) => share.amountVat.toFixed(2))).toEqual(['8.20', '8.19']);
    expect(allocations.every((share) => share.organizationId === parcel.organizationId)).toBe(true);
    expect(allocations.every((share) => share.storeId === parcel.storeId)).toBe(true);
  });

  it('applies the order settings snapshot', async () => {
    const parcel = await seedMelontikParcel({ snapshotIncludeNegativeNetVat: false });

    const result = await recompute(parcel.organizationId, parcel.orderId);
    expect(result.changed).toBe(true);
    expect(result.bestKnown.netProfit?.toFixed(2)).toBe('188.66');
  });

  it('does nothing on a second identical run', async () => {
    const parcel = await seedMelontikParcel();

    const first = await recompute(parcel.organizationId, parcel.orderId);
    expect(first.changed).toBe(true);

    const idsBefore = (
      await prisma.profitLine.findMany({
        where: { orderId: parcel.orderId },
        select: { id: true },
      })
    )
      .map((line) => line.id)
      .sort();
    const statementsBefore = await prisma.orderProfitStatement.findMany({
      where: { orderId: parcel.orderId },
      orderBy: { view: 'asc' },
      select: { view: true, updatedAt: true },
    });

    const second = await recompute(parcel.organizationId, parcel.orderId);
    expect(second.changed).toBe(false);

    const idsAfter = (
      await prisma.profitLine.findMany({
        where: { orderId: parcel.orderId },
        select: { id: true },
      })
    )
      .map((line) => line.id)
      .sort();
    expect(idsAfter).toEqual(idsBefore);

    const statementsAfter = await prisma.orderProfitStatement.findMany({
      where: { orderId: parcel.orderId },
      orderBy: { view: 'asc' },
      select: { view: true, updatedAt: true },
    });
    expect(statementsAfter).toEqual(statementsBefore);
  });

  it('rewrites when an input changes', async () => {
    const parcel = await seedMelontikParcel();
    const first = await recompute(parcel.organizationId, parcel.orderId);
    expect(first.changed).toBe(true);

    const oldIds = (
      await prisma.profitLine.findMany({
        where: { orderId: parcel.orderId },
        select: { id: true },
      })
    ).map((line) => line.id);

    // Bump item A's COGS version amount; the loader reads the version amountGross.
    await prisma.costProfileVersion.updateMany({
      where: { amountGross: MELONTIK.items.a.costGross },
      data: { amountGross: '250.00' },
    });

    const second = await recompute(parcel.organizationId, parcel.orderId);
    expect(second.changed).toBe(true);

    const cogsA = await prisma.profitLine.findFirst({
      where: {
        orderId: parcel.orderId,
        type: ProfitLineType.COST_COGS,
        orderItemId: parcel.itemA,
      },
    });
    expect(cogsA?.amountGross.toFixed(2)).toBe('250.00');

    const survivors = await prisma.profitLine.findMany({
      where: { orderId: parcel.orderId, id: { in: oldIds } },
    });
    expect(survivors).toHaveLength(0);
  });

  it('moves to PARTIALLY_SETTLED with raw sale, discount and payment records, then SETTLED with the cargo invoice', async () => {
    const tracking = BigInt('7331234567');
    const parcel = await seedMelontikParcel({ cargoTrackingNumber: tracking });

    for (const record of melontikSaleCycleRecordInputs(parcel)) {
      await insertFinanceRecord(record);
    }

    const partial = await recompute(parcel.organizationId, parcel.orderId);
    expect(partial.changed).toBe(true);
    expect(partial.bestKnown.status).toBe(ProfitStatus.PARTIALLY_SETTLED);
    expect(partial.bestKnown.netProfit?.toFixed(2)).toBe('191.79');

    // The estimate view ignores the settlement records, so it stays ESTIMATED even
    // as the best-known view walks its settlement states; the two views diverge.
    const estimateAfterPartial = await readStatement(parcel.orderId, ProfitStatementView.ESTIMATE);
    expect(estimateAfterPartial.status).toBe(ProfitStatus.ESTIMATED);
    expect(estimateAfterPartial.netProfit?.toFixed(2)).toBe('191.79');

    await insertFinanceRecord(melontikCargoInvoiceInput(parcel, tracking.toString()));

    const settled = await recompute(parcel.organizationId, parcel.orderId);
    expect(settled.changed).toBe(true);
    expect(settled.bestKnown.status).toBe(ProfitStatus.SETTLED);
    expect(settled.bestKnown.netProfit?.toFixed(2)).toBe('191.79');

    const bestKnown = await readStatement(parcel.orderId, ProfitStatementView.BEST_KNOWN);
    expect(bestKnown.status).toBe(ProfitStatus.SETTLED);

    const estimateAfterSettled = await readStatement(parcel.orderId, ProfitStatementView.ESTIMATE);
    expect(estimateAfterSettled.status).toBe(ProfitStatus.ESTIMATED);
    expect(estimateAfterSettled.netProfit?.toFixed(2)).toBe('191.79');
  });

  it('keeps the estimate view on estimates while the best-known view takes the actual amounts', async () => {
    const parcel = await seedMelontikParcel();

    // The golden sale-cycle records reconcile the best-known view back to the
    // estimate's 191.79 (pinned by the test above). Bump item A's actual commission
    // so the best-known view diverges while the estimate view ignores the records.
    //
    // Hand computation, anchored on the pinned 191.79 and changing nothing but item
    // A's actual commission:
    //   golden A commission net = credit-side 100.51 - discount-side 7.17 = 93.34,
    //           VAT = round(93.34 / 6) = 15.56
    //   bumped A commission net = 130.51 - 7.17 = 123.34, VAT = round(123.34 / 6) = 20.56
    //   commission is an input-VAT expense, so its hit on net profit is its ex-VAT amount.
    //   delta ex-VAT = (123.34 - 20.56) - (93.34 - 15.56) = 102.78 - 77.78 = 25.00
    //   => ESTIMATE netProfit = 191.79 (estimate only; records dropped from this view)
    //      BEST_KNOWN netProfit = 191.79 - 25.00 = 166.79 (actual commission applied)
    const records = melontikSaleCycleRecordInputs(parcel).map((record) =>
      record.recordId === 'sale-a' ? { ...record, commissionAmount: '130.51' } : record,
    );
    for (const record of records) {
      await insertFinanceRecord(record);
    }

    const result = await recompute(parcel.organizationId, parcel.orderId);
    expect(result.changed).toBe(true);
    expect(result.bestKnown.status).toBe(ProfitStatus.PARTIALLY_SETTLED);
    expect(result.bestKnown.netProfit?.toFixed(2)).toBe('166.79');

    const estimate = await readStatement(parcel.orderId, ProfitStatementView.ESTIMATE);
    const bestKnown = await readStatement(parcel.orderId, ProfitStatementView.BEST_KNOWN);

    // The two views carry different net profit numbers.
    expect(estimate.netProfit?.toFixed(2)).toBe('191.79');
    expect(bestKnown.netProfit?.toFixed(2)).toBe('166.79');
    expect(estimate.netProfit?.toFixed(2)).not.toBe(bestKnown.netProfit?.toFixed(2));

    // ...and different statuses: the estimate view never left ESTIMATED.
    expect(estimate.status).toBe(ProfitStatus.ESTIMATED);
    expect(bestKnown.status).toBe(ProfitStatus.PARTIALLY_SETTLED);
  });

  it('merges loader issues into the statements', async () => {
    const parcel = await seedMelontikParcel();
    await insertFinanceRecord({
      storeId: parcel.storeId,
      organizationId: parcel.organizationId,
      family: 'SETTLEMENT',
      transactionType: 'NotARealType',
      recordId: 'weird-1',
      shipmentPackageId: parcel.platformOrderId,
    });

    const result = await recompute(parcel.organizationId, parcel.orderId);
    expect(result.changed).toBe(true);
    expect(result.bestKnown.status).not.toBe(ProfitStatus.NOT_COMPUTABLE);

    const statements = await prisma.orderProfitStatement.findMany({
      where: { orderId: parcel.orderId },
    });
    expect(statements).toHaveLength(2);
    for (const statement of statements) {
      expect(issueCodesOf(statement.issues)).toContain(ProfitIssueCode.UNMAPPED_MARKETPLACE_RECORD);
      expect(statement.status).not.toBe(ProfitStatus.NOT_COMPUTABLE);
    }
  });

  it('allocates the actual cargo line of a parcel cancelled after shipment', async () => {
    const tracking = BigInt('7335550000');
    const parcel = await seedMelontikParcel({ status: 'CANCELLED', cargoTrackingNumber: tracking });
    await insertFinanceRecord(melontikCargoInvoiceInput(parcel, tracking.toString()));

    const result = await recompute(parcel.organizationId, parcel.orderId);
    expect(result.changed).toBe(true);
    expect(result.bestKnown.status).toBe(ProfitStatus.CANCELLED);

    const shippingLine = await prisma.profitLine.findFirst({
      where: { orderId: parcel.orderId, type: ProfitLineType.SHIPPING },
    });
    if (shippingLine === null) {
      throw new Error('expected a SHIPPING line for the cancelled parcel');
    }
    expect(shippingLine.amountGross.toFixed(2)).toBe('98.34');

    const allocations = await prisma.profitLineAllocation.findMany({
      where: { profitLineId: shippingLine.id },
    });
    expect(allocations).toHaveLength(2);
    const totalGross = allocations.reduce(
      (sum, share) => sum.add(new Decimal(share.amountGross.toString())),
      new Decimal(0),
    );
    expect(totalGross.toFixed(2)).toBe('98.34');
    expect(allocations.map((share) => share.orderItemId).sort()).toEqual(
      [parcel.itemA, parcel.itemB].sort(),
    );
  });

  it('refuses another organization and writes nothing', async () => {
    const parcel = await seedMelontikParcel();

    await expect(recompute(randomUUID(), parcel.orderId)).rejects.toBeInstanceOf(
      ParcelNotFoundError,
    );

    expect(await prisma.profitLine.count()).toBe(0);
    expect(await prisma.profitLineAllocation.count()).toBe(0);
    expect(await prisma.orderProfitStatement.count()).toBe(0);
  });

  it('writes an excluded order as EXCLUDED', async () => {
    const parcel = await seedMelontikParcel();
    // The pair-check constraint wants both exclusion columns set together, and the
    // freeze trigger allows a first-time exclusion on an uncalculated order.
    await prisma.order.update({
      where: { id: parcel.orderId },
      data: { profitExcludedAt: new Date(), profitExclusionReason: 'COST_DEADLINE_MISSED' },
    });

    const result = await recompute(parcel.organizationId, parcel.orderId);
    expect(result.changed).toBe(true);
    expect(result.bestKnown.status).toBe(ProfitStatus.EXCLUDED);

    const statements = await prisma.orderProfitStatement.findMany({
      where: { orderId: parcel.orderId },
    });
    expect(statements).toHaveLength(2);
    expect(statements.every((statement) => statement.status === ProfitStatus.EXCLUDED)).toBe(true);

    // The lines are still written for an excluded order.
    expect(await prisma.profitLine.count({ where: { orderId: parcel.orderId } })).toBeGreaterThan(
      0,
    );
  });

  it('writes a not-computable order with a null net profit and null ratios', async () => {
    const parcel = await seedMelontikParcel();
    // Drop every cost profile link so each item has no cost: a blocking MISSING_COST.
    await prisma.productVariantCostProfile.deleteMany({
      where: { organizationId: parcel.organizationId },
    });

    const result = await recompute(parcel.organizationId, parcel.orderId);
    expect(result.changed).toBe(true);
    expect(result.bestKnown.status).toBe(ProfitStatus.NOT_COMPUTABLE);
    expect(result.bestKnown.netProfit).toBeNull();

    const statements = await prisma.orderProfitStatement.findMany({
      where: { orderId: parcel.orderId },
    });
    expect(statements).toHaveLength(2);
    for (const statement of statements) {
      expect(statement.status).toBe(ProfitStatus.NOT_COMPUTABLE);
      expect(statement.netProfit).toBeNull();
      expect(statement.saleMarginPct).toBeNull();
      expect(statement.costMarkupPct).toBeNull();
      expect(issueCodesOf(statement.issues)).toContain(ProfitIssueCode.MISSING_COST);
    }
  });

  it('allocates only parcel-level lines', async () => {
    const parcel = await seedMelontikParcel();
    await recompute(parcel.organizationId, parcel.orderId);

    const lines = await prisma.profitLine.findMany({ where: { orderId: parcel.orderId } });
    const linesById = new Map(lines.map((line) => [line.id, line]));
    const allocations = await prisma.profitLineAllocation.findMany({
      where: { organizationId: parcel.organizationId },
    });

    // No allocation points at an item-level line.
    for (const allocation of allocations) {
      const parent = linesById.get(allocation.profitLineId);
      if (parent === undefined) {
        throw new Error('allocation points at a line of another parcel');
      }
      expect(parent.level).toBe(ProfitLineLevel.PARCEL);
    }

    // Every parcel-level line has allocations whose gross and VAT sum back to it.
    const parcelLines = lines.filter((line) => line.level === ProfitLineLevel.PARCEL);
    expect(parcelLines.length).toBeGreaterThan(0);
    for (const parcelLine of parcelLines) {
      const shares = allocations.filter((share) => share.profitLineId === parcelLine.id);
      expect(shares.length).toBeGreaterThan(0);
      const grossSum = shares.reduce(
        (sum, share) => sum.add(new Decimal(share.amountGross.toString())),
        new Decimal(0),
      );
      const vatSum = shares.reduce(
        (sum, share) => sum.add(new Decimal(share.amountVat.toString())),
        new Decimal(0),
      );
      expect(grossSum.toFixed(2)).toBe(new Decimal(parcelLine.amountGross.toString()).toFixed(2));
      expect(vatSum.toFixed(2)).toBe(new Decimal(parcelLine.amountVat.toString()).toFixed(2));
    }
  });

  it('leaves an existing parcel untouched when called with another organization', async () => {
    const parcel = await seedMelontikParcel();
    await recompute(parcel.organizationId, parcel.orderId);

    const linesBefore = await prisma.profitLine.findMany({
      where: { orderId: parcel.orderId },
      orderBy: { id: 'asc' },
    });
    const allocationsBefore = await prisma.profitLineAllocation.findMany({
      where: { organizationId: parcel.organizationId },
      orderBy: { id: 'asc' },
    });
    const statementsBefore = await prisma.orderProfitStatement.findMany({
      where: { orderId: parcel.orderId },
      orderBy: { view: 'asc' },
    });

    await expect(recompute(randomUUID(), parcel.orderId)).rejects.toBeInstanceOf(
      ParcelNotFoundError,
    );

    const linesAfter = await prisma.profitLine.findMany({
      where: { orderId: parcel.orderId },
      orderBy: { id: 'asc' },
    });
    const allocationsAfter = await prisma.profitLineAllocation.findMany({
      where: { organizationId: parcel.organizationId },
      orderBy: { id: 'asc' },
    });
    const statementsAfter = await prisma.orderProfitStatement.findMany({
      where: { orderId: parcel.orderId },
      orderBy: { view: 'asc' },
    });

    // Same ids and same values across all three tables: the cross-org call wrote nothing.
    expect(linesAfter).toEqual(linesBefore);
    expect(allocationsAfter).toEqual(allocationsBefore);
    expect(statementsAfter).toEqual(statementsBefore);
  });

  it('round-trips the fx columns at their stored precision', async () => {
    const parcel = await seedMelontikParcel();
    // A USD cost on item A, with a 6-decimal USD->TRY rate on the day before the
    // order's business date (2026-10-28), so the loader resolves the quote.
    await attachCostProfile({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      productVariantId: parcel.variantA,
      currency: 'USD',
      amountGross: '10.00',
      vatRate: '18.5',
    });
    await insertFxRate({
      currency: 'USD',
      rateDate: new Date('2026-10-27T00:00:00.000Z'),
      rateToTry: '32.123456',
    });

    await recompute(parcel.organizationId, parcel.orderId);

    const usdCost = await prisma.profitLine.findFirst({
      where: {
        orderId: parcel.orderId,
        orderItemId: parcel.itemA,
        type: ProfitLineType.COST_COGS,
        originalCurrency: 'USD',
      },
    });
    if (usdCost === null) {
      throw new Error('expected a USD COST_COGS line for item A');
    }

    expect(usdCost.originalCurrency).toBe('USD');
    // fx_rate is numeric(14,6): the six-decimal rate survives unchanged.
    expect(new Decimal(usdCost.fxRate.toString()).toFixed(6)).toBe('32.123456');
    // fx_rate_date is a DATE column: the same calendar day, no timezone shift.
    expect(usdCost.fxRateDate?.toISOString().slice(0, 10)).toBe('2026-10-27');
    // vat_rate_pct is numeric(7,4): the fractional rate keeps its decimals.
    expect(usdCost.vatRatePct).not.toBeNull();
    expect(new Decimal(String(usdCost.vatRatePct)).toFixed(4)).toBe('18.5000');
  });

  it('serializes two concurrent recomputes of the same parcel', async () => {
    const parcel = await seedMelontikParcel();
    const expectedLineCount = await estimateLineCount(parcel.organizationId, parcel.orderId);

    // This test only proves serialization because each $transaction runs on its own
    // pool connection (so the two advisory-lock waits are real, not reentrant on one
    // session) and because the writer reads at READ COMMITTED: the second call, once
    // it wins the lock, sees the first call's committed statements and no-ops on the
    // matching content hash. Under a single connection or a stricter isolation level
    // the assertion below (exactly one changed: true) would pass vacuously.
    const [first, second] = await Promise.all([
      recompute(parcel.organizationId, parcel.orderId),
      recompute(parcel.organizationId, parcel.orderId),
    ]);

    const changes = [first.changed, second.changed];
    expect(changes.filter((changed) => changed === true)).toHaveLength(1);
    expect(changes.filter((changed) => changed === false)).toHaveLength(1);

    expect(await prisma.profitLine.count({ where: { orderId: parcel.orderId } })).toBe(
      expectedLineCount,
    );
    expect(await prisma.orderProfitStatement.count({ where: { orderId: parcel.orderId } })).toBe(2);
  });
});
