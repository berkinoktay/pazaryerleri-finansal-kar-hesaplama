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
import { ProfitIssueCode, ProfitLineType, ProfitStatus } from '@pazarsync/db/enums';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { estimateTrendyolParcel } from '../../marketplaces/trendyol/estimate-parcel';
import { ParcelNotFoundError } from '../errors';
import { loadTrendyolParcel } from '../load-trendyol-parcel';
import { recomputeParcelProfit, type RecomputeParcelResult } from '../recompute-parcel-profit';
import {
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

    await insertFinanceRecord(melontikCargoInvoiceInput(parcel, tracking.toString()));

    const settled = await recompute(parcel.organizationId, parcel.orderId);
    expect(settled.changed).toBe(true);
    expect(settled.bestKnown.status).toBe(ProfitStatus.SETTLED);
    expect(settled.bestKnown.netProfit?.toFixed(2)).toBe('191.79');

    const bestKnown = await prisma.orderProfitStatement.findFirst({
      where: { orderId: parcel.orderId, view: 'BEST_KNOWN' },
    });
    expect(bestKnown?.status).toBe(ProfitStatus.SETTLED);
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

  it('serializes two concurrent recomputes of the same parcel', async () => {
    const parcel = await seedMelontikParcel();
    const expectedLineCount = await estimateLineCount(parcel.organizationId, parcel.orderId);

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
