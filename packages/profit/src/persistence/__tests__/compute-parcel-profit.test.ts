/**
 * Integration tests for computeParcelProfit (Phase 4A, Gorev 2). The read-only
 * computation must produce exactly what the writer persists, write nothing itself,
 * and raise the same errors the writer raises. Runs against the isolated test
 * database and reproduces the golden melontik parcel.
 *
 * Requires: `supabase start` + `pnpm db:push` before running.
 */

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { prisma, type Prisma } from '@pazarsync/db';
import {
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  ProfitLineType,
  ProfitStatementView,
  type ProfitStatus,
  type ReconciliationStatus,
} from '@pazarsync/db/enums';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PROFIT_ENGINE_VERSION } from '../../core/engine-version';
import { type ProfitLine } from '../../core/profit-line';
import { type ProfitStatement } from '../../core/profit-statement';
import { loadOrderProfitLines } from '../../read/load-order-profit-lines';
import { computeParcelProfit, type ComputedParcelProfit } from '../compute-parcel-profit';
import { ParcelNotFoundError, UnsupportedPlatformError } from '../errors';
import { recomputeParcelProfit } from '../recompute-parcel-profit';
import {
  createAdditionalStore,
  ensureDbReachable,
  seedBareOrder,
  seedMelontikParcel,
  truncateAll,
} from './helpers/melontik-parcel';

/** The margin columns are numeric(12,4); round the computed margins the same way the writer does. */
const PERCENT_SCALE = 4;

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

/** The comparable projection of a statement's totals, margins rounded to the stored precision. */
interface StatementProjection {
  readonly status: ProfitStatus;
  readonly reconciliationStatus: ReconciliationStatus;
  readonly saleGross: string;
  readonly costGross: string;
  readonly vatOutput: string;
  readonly vatInput: string;
  readonly vatNet: string;
  readonly vatEffective: string;
  readonly stoppageGross: string;
  readonly netProfit: string | null;
  readonly saleMarginPct: string | null;
  readonly costMarkupPct: string | null;
}

/** A percent rounded to the column's 4 decimals, half-up; null passes through. */
function roundPct(value: Decimal | null): string | null {
  return value === null
    ? null
    : value.toDecimalPlaces(PERCENT_SCALE, Decimal.ROUND_HALF_UP).toFixed();
}

function projectComputed(statement: ProfitStatement): StatementProjection {
  return {
    status: statement.status,
    reconciliationStatus: statement.reconciliationStatus,
    saleGross: statement.saleGross.toFixed(),
    costGross: statement.costGross.toFixed(),
    vatOutput: statement.vat.output.toFixed(),
    vatInput: statement.vat.input.toFixed(),
    vatNet: statement.vat.net.toFixed(),
    vatEffective: statement.vat.effective.toFixed(),
    stoppageGross: statement.stoppageGross.toFixed(),
    netProfit: statement.netProfit === null ? null : statement.netProfit.toFixed(),
    saleMarginPct: roundPct(statement.saleMarginPct),
    costMarkupPct: roundPct(statement.costMarkupPct),
  };
}

/** A stored statement row's Decimal (or null) column as a plain fixed-precision string. */
function decText(value: Prisma.Decimal | null): string | null {
  return value === null ? null : new Decimal(value.toString()).toFixed();
}

interface StoredStatementRow {
  readonly status: ProfitStatus;
  readonly reconciliationStatus: ReconciliationStatus;
  readonly saleGross: Prisma.Decimal;
  readonly costGross: Prisma.Decimal;
  readonly vatOutput: Prisma.Decimal;
  readonly vatInput: Prisma.Decimal;
  readonly vatNet: Prisma.Decimal;
  readonly vatEffective: Prisma.Decimal;
  readonly stoppageGross: Prisma.Decimal;
  readonly netProfit: Prisma.Decimal | null;
  readonly saleMarginPct: Prisma.Decimal | null;
  readonly costMarkupPct: Prisma.Decimal | null;
}

function projectStored(row: StoredStatementRow): StatementProjection {
  return {
    status: row.status,
    reconciliationStatus: row.reconciliationStatus,
    saleGross: new Decimal(row.saleGross.toString()).toFixed(),
    costGross: new Decimal(row.costGross.toString()).toFixed(),
    vatOutput: new Decimal(row.vatOutput.toString()).toFixed(),
    vatInput: new Decimal(row.vatInput.toString()).toFixed(),
    vatNet: new Decimal(row.vatNet.toString()).toFixed(),
    vatEffective: new Decimal(row.vatEffective.toString()).toFixed(),
    stoppageGross: new Decimal(row.stoppageGross.toString()).toFixed(),
    netProfit: decText(row.netProfit),
    saleMarginPct: decText(row.saleMarginPct),
    costMarkupPct: decText(row.costMarkupPct),
  };
}

/** Reads one persisted statement view for a parcel, failing when it is missing. */
async function readStoredStatement(
  orderId: string,
  view: ProfitStatementView,
): Promise<StoredStatementRow> {
  const row = await prisma.orderProfitStatement.findFirst({ where: { orderId, view } });
  if (row === null) {
    throw new Error(`expected a ${view} statement`);
  }
  return row;
}

/** A line's comparable projection: scalar fields plus Decimal amounts as fixed strings. */
interface LineProjection {
  readonly type: ProfitLineType;
  readonly level: ProfitLineLevel;
  readonly orderItemId: string | null;
  readonly certainty: ProfitLineCertainty;
  readonly source: ProfitLineSource;
  readonly gross: string;
  readonly vat: string;
  readonly vatRatePct: string | null;
  readonly inputs: ProfitLine['inputs'];
  readonly externalRecord: ProfitLine['externalRecord'];
}

function projectLine(line: ProfitLine): LineProjection {
  return {
    type: line.type,
    level: line.level,
    orderItemId: line.orderItemId,
    certainty: line.certainty,
    source: line.source,
    gross: line.amount.gross.toFixed(),
    vat: line.amount.vat.toFixed(),
    vatRatePct:
      line.vatRatePct === null
        ? null
        : line.vatRatePct.toDecimalPlaces(PERCENT_SCALE, Decimal.ROUND_HALF_UP).toFixed(),
    inputs: line.inputs,
    externalRecord: line.externalRecord,
  };
}

/** A deterministic sort key over the scalar fields, independent of `inputs` key order. */
function lineSortKey(line: LineProjection): string {
  return [
    line.type,
    line.level,
    line.orderItemId ?? '',
    line.certainty,
    line.source,
    line.gross,
    line.vat,
    line.vatRatePct ?? '',
  ].join('|');
}

function sortedProjection(lines: readonly ProfitLine[]): LineProjection[] {
  return lines.map(projectLine).sort((left, right) => {
    const leftKey = lineSortKey(left);
    const rightKey = lineSortKey(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

/** Loads the stored lines of several orders in one transaction. */
function loadLines(
  organizationId: string,
  storeId: string,
  orderIds: readonly string[],
): Promise<ReadonlyMap<string, readonly ProfitLine[]>> {
  return prisma.$transaction((tx) =>
    loadOrderProfitLines(tx, { organizationId, storeId, orderIds }),
  );
}

/** Seeds a Hepsiburada store with a bare order -- a platform the engine cannot compute. */
async function seedHepsiburadaOrder(): Promise<{ organizationId: string; orderId: string }> {
  const org = await prisma.organization.create({
    data: { name: 'Hepsiburada Org', slug: `hb-${randomUUID().slice(0, 8)}` },
  });
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Hepsiburada Store',
      platform: 'HEPSIBURADA',
      environment: 'PRODUCTION',
      externalAccountId: randomUUID(),
      status: 'ACTIVE',
      credentials: 'test-encrypted-blob',
      shippingTariffSource: 'TRENDYOL_CONTRACT',
    },
  });
  const order = await prisma.order.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformOrderId: `hb-${randomUUID().slice(0, 8)}`,
      orderDate: new Date('2026-10-28T09:00:00Z'),
      status: 'DELIVERED',
      micro: false,
      fastDelivery: false,
      fastDeliveryType: null,
      usesSellerCargoAgreement: false,
    },
  });
  return { organizationId: org.id, orderId: order.id };
}

describe('computeParcelProfit', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('computes the same statements the writer persists', async () => {
    const parcel = await seedMelontikParcel();
    await runWriter(parcel.organizationId, parcel.orderId);

    const computed = await compute(parcel.organizationId, parcel.orderId);

    const storedEstimate = await readStoredStatement(parcel.orderId, ProfitStatementView.ESTIMATE);
    const storedBestKnown = await readStoredStatement(
      parcel.orderId,
      ProfitStatementView.BEST_KNOWN,
    );

    expect(projectComputed(computed.estimate)).toEqual(projectStored(storedEstimate));
    expect(projectComputed(computed.bestKnown)).toEqual(projectStored(storedBestKnown));
  });

  it('writes nothing', async () => {
    const parcel = await seedMelontikParcel();
    // A freshly seeded parcel has no statements, lines or allocations.
    const where = { organizationId: parcel.organizationId } as const;
    const linesBefore = await prisma.profitLine.count({ where });
    const allocationsBefore = await prisma.profitLineAllocation.count({ where });
    const statementsBefore = await prisma.orderProfitStatement.count({ where });
    expect([linesBefore, allocationsBefore, statementsBefore]).toEqual([0, 0, 0]);

    await compute(parcel.organizationId, parcel.orderId);

    expect(await prisma.profitLine.count({ where })).toBe(linesBefore);
    expect(await prisma.profitLineAllocation.count({ where })).toBe(allocationsBefore);
    expect(await prisma.orderProfitStatement.count({ where })).toBe(statementsBefore);
  });

  it('rejects an order of another organization', async () => {
    const parcel = await seedMelontikParcel();

    await expect(compute(randomUUID(), parcel.orderId)).rejects.toBeInstanceOf(ParcelNotFoundError);
  });

  it('rejects a platform without a computer', async () => {
    const { organizationId, orderId } = await seedHepsiburadaOrder();

    await expect(compute(organizationId, orderId)).rejects.toBeInstanceOf(UnsupportedPlatformError);
  });

  it("returns each order's lines, round-tripping the writer's lines", async () => {
    const parcel = await seedMelontikParcel();
    await runWriter(parcel.organizationId, parcel.orderId);
    // A second order in the same store with no profit lines at all.
    const emptyOrderId = await seedBareOrder({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
    });

    const computed = await compute(parcel.organizationId, parcel.orderId);
    const loaded = await loadLines(parcel.organizationId, parcel.storeId, [
      parcel.orderId,
      emptyOrderId,
    ]);

    // The writer's stored lines round-trip to the freshly computed lines.
    const loadedLines = loaded.get(parcel.orderId);
    if (loadedLines === undefined) {
      throw new Error('expected the parcel order id in the map');
    }
    expect(loadedLines.length).toBeGreaterThan(0);
    expect(sortedProjection(loadedLines)).toEqual(sortedProjection(computed.lines));

    // An order without lines maps to an empty array, not a missing key.
    expect(loaded.get(emptyOrderId)).toEqual([]);
  });

  it('ignores lines of another organization or store', async () => {
    const parcel = await seedMelontikParcel();
    await runWriter(parcel.organizationId, parcel.orderId);

    const realCount = await prisma.profitLine.count({
      where: {
        orderId: parcel.orderId,
        organizationId: parcel.organizationId,
        storeId: parcel.storeId,
      },
    });
    expect(realCount).toBeGreaterThan(0);

    // The composite tenant FK forbids filing a line under the parcel's order id with a
    // foreign org/store, so each foreign line sits on an order that genuinely belongs to
    // that other store/org: a sibling store in the same organization, and a whole other
    // organization's parcel. The loader, scoped to the parcel's org AND store, must
    // return neither.
    const siblingStoreId = await createAdditionalStore({ organizationId: parcel.organizationId });
    const siblingOrderId = await seedBareOrder({
      organizationId: parcel.organizationId,
      storeId: siblingStoreId,
    });
    const other = await seedMelontikParcel();

    const foreignLine = {
      type: ProfitLineType.SHIPPING,
      level: ProfitLineLevel.PARCEL,
      certainty: ProfitLineCertainty.ESTIMATE,
      source: ProfitLineSource.RULE,
      amountGross: '0',
      amountVat: '0',
      inputs: {},
      engineVersion: PROFIT_ENGINE_VERSION,
    } as const;
    await prisma.profitLine.create({
      data: {
        ...foreignLine,
        organizationId: parcel.organizationId,
        storeId: siblingStoreId,
        orderId: siblingOrderId,
      },
    });
    await prisma.profitLine.create({
      data: {
        ...foreignLine,
        organizationId: other.organizationId,
        storeId: other.storeId,
        orderId: other.orderId,
      },
    });

    // Scoped to the parcel's own org and store, the loader returns only the parcel's
    // lines; the sibling-store and other-org orders map to empty arrays.
    const loaded = await loadLines(parcel.organizationId, parcel.storeId, [
      parcel.orderId,
      siblingOrderId,
      other.orderId,
    ]);
    expect(loaded.get(parcel.orderId)?.length).toBe(realCount);
    expect(loaded.get(siblingOrderId)).toEqual([]);
    expect(loaded.get(other.orderId)).toEqual([]);
  });
});
