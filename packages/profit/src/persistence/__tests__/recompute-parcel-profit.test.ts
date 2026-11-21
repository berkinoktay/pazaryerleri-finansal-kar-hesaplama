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
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  ProfitLineType,
  ProfitStatementView,
  ProfitStatus,
  ReconciliationStatus,
} from '@pazarsync/db/enums';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { estimateTrendyolParcel } from '../../marketplaces/trendyol/estimate-parcel';
import { ParcelNotFoundError } from '../errors';
import { loadTrendyolParcel } from '../load-trendyol-parcel';
import {
  acquireParcelProfitLock,
  recomputeParcelProfit,
  type RecomputeParcelResult,
} from '../recompute-parcel-profit';
import { deferred, delay } from './helpers/concurrency';
import {
  attachCostProfile,
  ensureDbReachable,
  insertFinanceRecord,
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

    const statementsBefore = await prisma.orderProfitStatement.findMany({
      where: { orderId: parcel.orderId },
      orderBy: { view: 'asc' },
      select: { view: true, contentHash: true, netProfit: true },
    });
    expect(statementsBefore).toHaveLength(2);

    // The order's own data changes: a later webhook event brings item A's own
    // commission rate (two-phase webhook), 19 -> 25. The order profit snapshot never
    // freezes the order line's rate, so the recompute picks it up.
    await prisma.orderItem.update({
      where: { id: parcel.itemA, organizationId: parcel.organizationId },
      data: { orderCommissionRatePct: '25' },
    });

    const second = await recompute(parcel.organizationId, parcel.orderId);
    expect(second.changed).toBe(true);

    // 529.00 x 25% - 37.72 x 25% = 132.25 - 9.43 (was 100.51 - 7.17 = 93.34 at 19%).
    const commissionA = await prisma.profitLine.findFirst({
      where: {
        orderId: parcel.orderId,
        type: ProfitLineType.COMMISSION,
        orderItemId: parcel.itemA,
      },
    });
    expect(commissionA?.amountGross.toString()).toBe('122.82');
    expect(commissionA?.inputs).toMatchObject({ ratePct: '25', rateSource: 'ORDER' });

    const survivors = await prisma.profitLine.findMany({
      where: { orderId: parcel.orderId, id: { in: oldIds } },
    });
    expect(survivors).toHaveLength(0);

    // Both statement views were rewritten with the new content.
    const statementsAfter = await prisma.orderProfitStatement.findMany({
      where: { orderId: parcel.orderId },
      orderBy: { view: 'asc' },
      select: { view: true, contentHash: true, netProfit: true },
    });
    expect(statementsAfter).toHaveLength(2);
    for (const [index, after] of statementsAfter.entries()) {
      const before = statementsBefore[index];
      expect(after.view).toBe(before?.view);
      expect(after.contentHash).not.toBe(before?.contentHash);
      expect(after.netProfit?.toString()).not.toBe(before?.netProfit?.toString());
    }
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

  it('persists the reconciliation status of both views', async () => {
    const parcel = await seedMelontikParcel();
    // The sale-cycle records give the best-known view settlement-sourced actuals while
    // the shipping leg stays an estimate, so it reconciles to PARTIALLY_SETTLED; the
    // estimate view ignores the records and stays NOT_SETTLED.
    for (const record of melontikSaleCycleRecordInputs(parcel)) {
      await insertFinanceRecord(record);
    }

    const result = await recompute(parcel.organizationId, parcel.orderId);
    expect(result.changed).toBe(true);

    const bestKnown = await prisma.orderProfitStatement.findFirst({
      where: { orderId: parcel.orderId, view: ProfitStatementView.BEST_KNOWN },
    });
    const estimate = await prisma.orderProfitStatement.findFirst({
      where: { orderId: parcel.orderId, view: ProfitStatementView.ESTIMATE },
    });
    expect(bestKnown?.reconciliationStatus).toBe(ReconciliationStatus.PARTIALLY_SETTLED);
    expect(estimate?.reconciliationStatus).toBe(ReconciliationStatus.NOT_SETTLED);
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

  it('nets a fully returned couponed item whose return records carry no package id', async () => {
    const orderNumber = 'ORDER-4B-E2E';
    const parcel = await seedMelontikParcel();
    await prisma.order.update({
      where: { id: parcel.orderId },
      data: { platformOrderNumber: orderNumber },
    });
    const base = { storeId: parcel.storeId, organizationId: parcel.organizationId } as const;
    const barcode = MELONTIK.items.a.barcode;

    // The sale side lands on the outbound package; the Return and both reversals carry
    // NO shipment package id and bind only by order number + barcode (Gorev 4B). A fully
    // returned couponed item nets each leg to the same amount:
    //   SALE = 333.50 - 3.34 - 250.00 = 80.16; COMMISSION = 66.70 - 0.67 - 50.00 = 16.03;
    //   the return legs net the same, so sale minus return is zero.
    await insertFinanceRecord({
      ...base,
      family: 'SETTLEMENT',
      transactionType: 'Sale',
      recordId: 'sale-a',
      shipmentPackageId: parcel.platformOrderId,
      barcode,
      credit: '333.50',
      commissionAmount: '66.70',
    });
    await insertFinanceRecord({
      ...base,
      family: 'SETTLEMENT',
      transactionType: 'Discount',
      recordId: 'disc-a',
      shipmentPackageId: parcel.platformOrderId,
      barcode,
      debt: '3.34',
      commissionAmount: '0.67',
    });
    await insertFinanceRecord({
      ...base,
      family: 'SETTLEMENT',
      transactionType: 'Coupon',
      recordId: 'coup-a',
      shipmentPackageId: parcel.platformOrderId,
      barcode,
      debt: '250.00',
      commissionAmount: '50.00',
    });
    await insertFinanceRecord({
      ...base,
      family: 'SETTLEMENT',
      transactionType: 'Return',
      recordId: 'ret-a',
      shipmentPackageId: null,
      orderNumber,
      barcode,
      debt: '333.50',
      commissionAmount: '66.70',
    });
    await insertFinanceRecord({
      ...base,
      family: 'SETTLEMENT',
      transactionType: 'DiscountCancel',
      recordId: 'dc-a',
      shipmentPackageId: null,
      orderNumber,
      barcode,
      credit: '3.34',
      commissionAmount: '0.67',
    });
    await insertFinanceRecord({
      ...base,
      family: 'SETTLEMENT',
      transactionType: 'CouponCancel',
      recordId: 'cc-a',
      shipmentPackageId: null,
      orderNumber,
      barcode,
      credit: '250.00',
      commissionAmount: '50.00',
    });

    const result = await recompute(parcel.organizationId, parcel.orderId);
    expect(result.changed).toBe(true);

    // The actual (marketplace-record) lines the mapper netted for item A.
    const actualLines = await prisma.profitLine.findMany({
      where: {
        orderId: parcel.orderId,
        orderItemId: parcel.itemA,
        source: ProfitLineSource.MARKETPLACE_RECORD,
      },
    });
    const grossOf = (type: ProfitLineType): string | undefined =>
      actualLines.find((line) => line.type === type)?.amountGross.toFixed(2);

    expect(grossOf(ProfitLineType.SALE)).toBe('80.16');
    expect(grossOf(ProfitLineType.SALE_RETURN)).toBe('80.16');
    expect(grossOf(ProfitLineType.COMMISSION)).toBe('16.03');
    expect(grossOf(ProfitLineType.COMMISSION_REFUND)).toBe('16.03');
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

  it('replaces the zero estimate of an unrecognized carrier with a later cargo invoice', async () => {
    // Trendyol named a carrier we cannot recognize, so the forward estimate is a zero
    // SHIPPING line. When the cargo invoice arrives it writes an ACTUAL SHIPPING line and
    // the statement selects it, so the real cost (98.34) replaces the zero estimate.
    const tracking = BigInt('7335551111');
    const parcel = await seedMelontikParcel({ cargoTrackingNumber: tracking });
    await prisma.order.update({
      where: { id: parcel.orderId },
      data: { cargoProviderName: 'Alternative Delivery' },
    });
    await insertFinanceRecord(melontikCargoInvoiceInput(parcel, tracking.toString()));

    const result = await recompute(parcel.organizationId, parcel.orderId);
    expect(result.changed).toBe(true);

    const shippingLines = await prisma.profitLine.findMany({
      where: { orderId: parcel.orderId, type: ProfitLineType.SHIPPING },
    });
    const estimate = shippingLines.find((line) => line.certainty === ProfitLineCertainty.ESTIMATE);
    const actual = shippingLines.find((line) => line.certainty === ProfitLineCertainty.ACTUAL);
    // The zero estimate stays recorded (with its reason) while the ACTUAL cargo invoice
    // supplies the real amount that the statement selects.
    expect(estimate?.amountGross.toFixed(2)).toBe('0.00');
    expect(estimate?.inputs).toMatchObject({ reason: 'CARRIER_NOT_RECOGNIZED' });
    expect(actual?.amountGross.toFixed(2)).toBe('98.34');
  });

  it('writes a cancelled parcel without any records as CANCELLED with no lines', async () => {
    // A cancelled parcel with no finance records has no estimate lines and no actual
    // lines, so the writer persists zero profit lines and zero allocations. This
    // guards the empty-createMany path: lineRows is [] and must be skipped.
    const parcel = await seedMelontikParcel({ status: 'CANCELLED' });

    const first = await recompute(parcel.organizationId, parcel.orderId);
    expect(first.changed).toBe(true);
    expect(first.bestKnown.status).toBe(ProfitStatus.CANCELLED);

    expect(await prisma.profitLine.count({ where: { orderId: parcel.orderId } })).toBe(0);
    expect(
      await prisma.profitLineAllocation.count({ where: { organizationId: parcel.organizationId } }),
    ).toBe(0);

    const statements = await prisma.orderProfitStatement.findMany({
      where: { orderId: parcel.orderId },
    });
    expect(statements).toHaveLength(2);
    expect(statements.every((statement) => statement.status === ProfitStatus.CANCELLED)).toBe(true);

    // A second identical run finds both statement views already carry this content
    // hash and writes nothing.
    const second = await recompute(parcel.organizationId, parcel.orderId);
    expect(second.changed).toBe(false);
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
    // The pair-check constraint wants both exclusion columns set together; while
    // the stamp is present the engine writes the order as EXCLUDED.
    await prisma.order.update({
      where: { id: parcel.orderId },
      data: { profitExcludedAt: new Date(), profitExclusionReason: 'COST_DEADLINE_MISSED' },
    });

    const result = await recompute(parcel.organizationId, parcel.orderId);
    expect(result.changed).toBe(true);
    expect(result.bestKnown.status).toBe(ProfitStatus.EXCLUDED);
    expect(result.bestKnown.netProfit).toBeNull();

    const statements = await prisma.orderProfitStatement.findMany({
      where: { orderId: parcel.orderId },
    });
    expect(statements).toHaveLength(2);
    for (const statement of statements) {
      expect(statement.status).toBe(ProfitStatus.EXCLUDED);
      // An excluded order carries no net profit and no margins in either view...
      expect(statement.netProfit).toBeNull();
      expect(statement.saleMarginPct).toBeNull();
      expect(statement.costMarkupPct).toBeNull();
      // ...while its revenue still counts.
      expect(new Decimal(statement.saleGross.toString()).gt(0)).toBe(true);
    }

    // The lines are still written for an excluded order.
    expect(await prisma.profitLine.count({ where: { orderId: parcel.orderId } })).toBeGreaterThan(
      0,
    );
  });

  it('keeps an excluded order out of profit after its cost arrives', async () => {
    const parcel = await seedMelontikParcel();
    // Start from an excluded order whose variants carry no cost at all: drop every
    // cost profile link, then stamp the exclusion.
    await prisma.productVariantCostProfile.deleteMany({
      where: { organizationId: parcel.organizationId },
    });
    await prisma.order.update({
      where: { id: parcel.orderId },
      data: { profitExcludedAt: new Date(), profitExclusionReason: 'COST_DEADLINE_MISSED' },
    });

    const first = await recompute(parcel.organizationId, parcel.orderId);
    expect(first.changed).toBe(true);
    expect(first.bestKnown.status).toBe(ProfitStatus.EXCLUDED);
    expect(first.bestKnown.netProfit).toBeNull();

    // A cost profile (with a version) is attached to each variant after the fact and
    // the order is recomputed. The cost lines now exist, but the excluded order still
    // carries no net profit and no margins -- its cost never enters a profit figure.
    await attachCostProfile({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      productVariantId: parcel.variantA,
      amountGross: MELONTIK.items.a.costGross,
      vatRate: MELONTIK.costVatRate,
    });
    await attachCostProfile({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      productVariantId: parcel.variantB,
      amountGross: MELONTIK.items.b.costGross,
      vatRate: MELONTIK.costVatRate,
    });

    const second = await recompute(parcel.organizationId, parcel.orderId);
    expect(second.changed).toBe(true);
    expect(second.bestKnown.status).toBe(ProfitStatus.EXCLUDED);
    expect(second.bestKnown.netProfit).toBeNull();

    const statements = await prisma.orderProfitStatement.findMany({
      where: { orderId: parcel.orderId },
    });
    expect(statements).toHaveLength(2);
    for (const statement of statements) {
      expect(statement.status).toBe(ProfitStatus.EXCLUDED);
      expect(statement.netProfit).toBeNull();
      expect(statement.saleMarginPct).toBeNull();
      expect(statement.costMarkupPct).toBeNull();
      expect(new Decimal(statement.saleGross.toString()).gt(0)).toBe(true);
    }

    // The freshly attached cost is present on the parcel as cost lines.
    expect(
      await prisma.profitLine.count({
        where: { orderId: parcel.orderId, type: ProfitLineType.COST_COGS },
      }),
    ).toBeGreaterThan(0);
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

  it('round-trips vat_rate_pct at its stored precision', async () => {
    const parcel = await seedMelontikParcel();
    await recompute(parcel.organizationId, parcel.orderId);

    const cost = await prisma.profitLine.findFirst({
      where: {
        orderId: parcel.orderId,
        orderItemId: parcel.itemA,
        type: ProfitLineType.COST_COGS,
      },
    });
    if (cost === null) {
      throw new Error('expected a COST_COGS line for item A');
    }

    // vat_rate_pct is numeric(7,4): the melontik cost VAT rate (10%) keeps its decimals.
    expect(cost.vatRatePct).not.toBeNull();
    expect(new Decimal(String(cost.vatRatePct)).toFixed(4)).toBe('10.0000');
  });

  it('waits for a parcel lock held by another transaction', async () => {
    const parcel = await seedMelontikParcel();
    const expectedLineCount = await estimateLineCount(parcel.organizationId, parcel.orderId);

    const held = deferred<void>();
    const releaseGate = deferred<void>();

    // Transaction H grabs the parcel lock, signals, then parks on releaseGate: it
    // keeps the advisory lock for exactly as long as the test holds the gate shut.
    const holder = prisma.$transaction(
      async (tx) => {
        await acquireParcelProfitLock(tx, parcel.orderId);
        held.resolve();
        await releaseGate.promise;
      },
      { maxWait: 15000, timeout: 30000 },
    );

    let writer: Promise<RecomputeParcelResult> | undefined;
    try {
      await held.promise;

      // Writer W is a full recompute in its own transaction. It must block on the
      // advisory lock that H holds before it can touch the parcel.
      let writerSettled = false;
      writer = recompute(parcel.organizationId, parcel.orderId);
      // Observe settlement and swallow any rejection here, so a writer failure can
      // never surface as an unhandled rejection; the real result is awaited below.
      void writer.then(
        () => {
          writerSettled = true;
        },
        () => {
          writerSettled = true;
        },
      );

      // Prove W is parked on an advisory lock, polling pg_locks from the plain client
      // (outside both transactions). Without the lock in recomputeParcelProfit, W
      // never waits: it settles early (breaking the loop) or the 10s window elapses,
      // and the throw below fails the test deterministically.
      const deadline = Date.now() + 10000;
      let sawWaiting = false;
      while (Date.now() < deadline && !writerSettled) {
        const rows = await prisma.$queryRaw<{ waiting: number }[]>`
          SELECT count(*)::int AS waiting
          FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted`;
        if ((rows[0]?.waiting ?? 0) >= 1) {
          sawWaiting = true;
          break;
        }
        await delay(50);
      }

      if (!sawWaiting) {
        throw new Error(
          `writer never blocked on an advisory lock (writerSettled=${String(writerSettled)}): ` +
            'the parcel lock is not serializing writers of the same parcel',
        );
      }
      // While H still holds the lock, W cannot have finished.
      expect(writerSettled).toBe(false);

      // Release H; it commits and drops the lock, then W wins it and completes.
      releaseGate.resolve();
      await holder;

      const result = await writer;
      expect(result.changed).toBe(true);
      expect(await prisma.profitLine.count({ where: { orderId: parcel.orderId } })).toBe(
        expectedLineCount,
      );
      expect(await prisma.orderProfitStatement.count({ where: { orderId: parcel.orderId } })).toBe(
        2,
      );
    } finally {
      // Always open the gate and drain both transactions, so a failed assertion
      // never leaks the held lock or hangs the suite on a pending transaction.
      releaseGate.resolve();
      await holder.catch(() => undefined);
      if (writer !== undefined) {
        await writer.catch(() => undefined);
      }
    }
    // Above the 10s poll window, so a mutant without the lock fails with the clear
    // message from the throw, not a generic vitest timeout.
  }, 20000);

  it('serializes two concurrent recomputes of the same parcel', async () => {
    const parcel = await seedMelontikParcel();
    const expectedLineCount = await estimateLineCount(parcel.organizationId, parcel.orderId);

    // Smoke test only. The advisory lock itself is pinned by the deterministic
    // 'waits for a parcel lock held by another transaction' test above; here we just
    // fire two recomputes at once and assert the end state is consistent -- exactly
    // one of them wrote, and the parcel carries a single set of rows, not two.
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
