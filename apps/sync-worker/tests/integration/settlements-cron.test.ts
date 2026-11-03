// Settlement cron integration test (phase 3B — raw finance-record ingest).
//
// The cron no longer writes legacy order_fees / reconciliationStatus. Every fetched
// settlement, otherfinancials and cargo-invoice row is stored verbatim in
// marketplace_finance_records and the orders it binds to are enqueued for a profit
// recompute. These tests drive the same registry-bound entrypoint the worker claims
// (processSettlementsChunk) with mock fetchers and assert on the raw rows, the queue,
// and — for the end-to-end case — the drained profit statement.

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@pazarsync/db';
import {
  FinanceRecordFamily,
  ProfitRecomputeReason,
  ProfitStatementView,
  ProfitStatus,
} from '@pazarsync/db/enums';
import { encryptCredentials, syncLog } from '@pazarsync/sync-core';
import type {
  CargoInvoiceItem,
  FetchOtherFinancialsOpts,
  FetchSettlementsOpts,
  FinancialScanSummary,
  TrendyolFinancialTransaction,
} from '@pazarsync/marketplace';
import { drainProfitRecomputeQueue } from '@pazarsync/profit';

import { processSettlementsChunk } from '../../src/handlers/settlements';

import {
  createMembership,
  createOrganization,
  createUserProfile,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';
import {
  MELONTIK,
  seedMelontikParcel,
} from '../../../../packages/profit/src/persistence/__tests__/helpers/melontik-parcel';

// Settlements heartbeat is lease-fenced: the syncLog is created RUNNING and claimed by
// this id, and every direct processSettlementsChunk call passes it.
const WORKER_ID = 'worker-test';

const BARCODE = 'EAN13-CRON';
// A numeric platform order id so a settlement row's numeric shipmentPackageId binds it.
const SHIPMENT_PACKAGE_ID = 444_555_666;
const PAYMENT_ORDER_ID = 99_999_111;
const CARGO_INVOICE_RESPONSE_TYPE = 'Kargo Fatura';
const DAY_MS = 24 * 60 * 60 * 1000;

interface SimpleCtx {
  storeId: string;
  organizationId: string;
  orderId: string;
  syncLogId: string;
}

/** A store + a single numeric-platformOrderId order + a SETTLEMENTS syncLog claimed here. */
async function buildScenario(opts: { storeCreatedAt?: Date } = {}): Promise<SimpleCtx> {
  const user = await createUserProfile();
  const org = await createOrganization();
  await createMembership(org.id, user.id);

  const credentials = encryptCredentials({ supplierId: '123456', apiKey: 'k', apiSecret: 's' });
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Cron Test Store',
      platform: 'TRENDYOL',
      environment: 'SANDBOX',
      externalAccountId: '123456',
      credentials,
      status: 'ACTIVE',
      // The prune window derives from store.createdAt (via the orders cutoff clamp), so a
      // test that needs a non-empty window sets an older createdAt; undefined keeps the
      // DB default (now), which collapses the prune window to empty.
      createdAt: opts.storeCreatedAt,
    },
  });

  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
      productMainId: `main-${randomUUID().slice(0, 8)}`,
      title: 'Cron Test Product',
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
      barcode: BARCODE,
      stockCode: `SKU-${randomUUID().slice(0, 8)}`,
      salePrice: new Decimal('120.00'),
      listPrice: new Decimal('120.00'),
    },
  });

  const order = await prisma.order.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformOrderId: SHIPMENT_PACKAGE_ID.toString(),
      orderDate: new Date(),
      status: 'DELIVERED',
      saleGross: new Decimal('120.00'),
      saleVat: new Decimal('20.00'),
    },
  });
  await prisma.orderItem.create({
    data: {
      orderId: order.id,
      organizationId: org.id,
      productVariantId: variant.id,
      quantity: 1,
      lineListGross: new Decimal('120.00'),
      lineSaleGross: new Decimal('120.00'),
      lineSellerDiscountGross: new Decimal('0'),
      saleVatRate: new Decimal('20.00'),
      commissionRate: new Decimal('10.00'),
      commissionGross: new Decimal('12.00'),
    },
  });

  const syncLog = await createSyncLog(org.id, store.id);
  return { storeId: store.id, organizationId: org.id, orderId: order.id, syncLogId: syncLog.id };
}

async function createSyncLog(organizationId: string, storeId: string): Promise<{ id: string }> {
  return prisma.syncLog.create({
    data: {
      organizationId,
      storeId,
      syncType: 'SETTLEMENTS',
      status: 'RUNNING',
      startedAt: new Date(),
      claimedAt: new Date(),
      claimedBy: WORKER_ID,
      lastTickAt: new Date(),
      progressCurrent: 0,
    },
  });
}

// ─── Mock fetcher row builders ───────────────────────────────────────────

const BASE_TX: TrendyolFinancialTransaction = {
  id: 'tx-1',
  transactionDate: 1_715_000_000_000,
  barcode: null,
  transactionType: 'Satış',
  receiptId: null,
  description: null,
  debt: 0,
  credit: 0,
  paymentPeriod: null,
  commissionRate: null,
  commissionAmount: null,
  commissionInvoiceSerialNumber: null,
  sellerRevenue: null,
  orderNumber: null,
  paymentOrderId: null,
  paymentDate: null,
  sellerId: 123456,
  storeId: null,
  storeName: null,
  storeAddress: null,
  country: 'Türkiye',
  orderDate: null,
  affiliate: 'TRENDYOLTR',
  shipmentPackageId: null,
};

function tx(
  overrides: Partial<TrendyolFinancialTransaction> & { id: string },
): TrendyolFinancialTransaction {
  return { ...BASE_TX, ...overrides };
}

function saleRow(
  id: string,
  barcode: string,
  credit: number,
  commissionAmount: number,
): TrendyolFinancialTransaction {
  return tx({
    id,
    transactionType: 'Satış',
    barcode,
    credit,
    commissionAmount,
    shipmentPackageId: SHIPMENT_PACKAGE_ID,
    paymentOrderId: PAYMENT_ORDER_ID,
  });
}

/** A Sale row bound to the scenario order, dated at an explicit instant (prune tests). */
function saleRowOn(id: string, transactionDate: number): TrendyolFinancialTransaction {
  return tx({
    id,
    transactionType: 'Satış',
    barcode: BARCODE,
    credit: 120,
    commissionAmount: 12,
    shipmentPackageId: SHIPMENT_PACKAGE_ID,
    paymentOrderId: PAYMENT_ORDER_ID,
    transactionDate,
  });
}

function discountRow(
  id: string,
  barcode: string,
  debt: number,
  commissionAmount: number,
): TrendyolFinancialTransaction {
  return tx({
    id,
    transactionType: 'İndirim',
    barcode,
    debt,
    commissionAmount,
    shipmentPackageId: SHIPMENT_PACKAGE_ID,
  });
}

function stoppageRow(): TrendyolFinancialTransaction {
  return tx({ id: 'stoppage-1', transactionType: 'E-ticaret Stopajı', debt: 1.0 });
}

function paymentOrderRow(): TrendyolFinancialTransaction {
  return tx({
    id: PAYMENT_ORDER_ID.toString(),
    transactionType: 'Ödeme',
    debt: 100,
    paymentOrderId: PAYMENT_ORDER_ID,
  });
}

function cargoInvoiceRow(id: string): TrendyolFinancialTransaction {
  return tx({ id, transactionType: CARGO_INVOICE_RESPONSE_TYPE });
}

const CARGO_OUTBOUND_TYPE = 'Gönderi Kargo Bedeli';

function cargoItem(parcelUniqueId: number, amount: number, desi: number): CargoInvoiceItem {
  return {
    shipmentPackageType: CARGO_OUTBOUND_TYPE,
    parcelUniqueId,
    orderNumber: '11101228439',
    amount,
    desi,
  };
}

// ─── Mock fetcher factory ────────────────────────────────────────────────

interface MockScenario {
  settlements?: Partial<Record<'Sale' | 'Discount' | 'Return', TrendyolFinancialTransaction[]>>;
  otherFinancials?: Partial<
    Record<'PaymentOrder' | 'Stoppage' | 'DeductionInvoices', TrendyolFinancialTransaction[]>
  >;
  cargoItems?: CargoInvoiceItem[];
  /**
   * Overrides the reported totalElements per settlement type so a scan can be made to
   * come back short of its total (an incomplete scan the prune must refuse). Absent, the
   * reported total equals the number of rows yielded (a complete scan).
   */
  settlementTotals?: Partial<Record<'Sale' | 'Discount' | 'Return', number>>;
}

function makeMockFetchers(scenario: MockScenario) {
  return {
    fetchSettlements: async function* (
      opts: FetchSettlementsOpts,
    ): AsyncGenerator<TrendyolFinancialTransaction, FinancialScanSummary> {
      const type = opts.transactionType as 'Sale' | 'Discount' | 'Return';
      const rows = scenario.settlements?.[type] ?? [];
      for (const row of rows) yield row;
      const totalElements = scenario.settlementTotals?.[type] ?? rows.length;
      return { totalElements, yielded: rows.length };
    },
    fetchOtherFinancials: async function* (
      opts: FetchOtherFinancialsOpts,
    ): AsyncGenerator<TrendyolFinancialTransaction, FinancialScanSummary> {
      const rows =
        scenario.otherFinancials?.[
          opts.transactionType as 'PaymentOrder' | 'Stoppage' | 'DeductionInvoices'
        ] ?? [];
      for (const row of rows) yield row;
      return { totalElements: rows.length, yielded: rows.length };
    },
    fetchCargoInvoiceItems: async (): Promise<CargoInvoiceItem[]> => scenario.cargoItems ?? [],
  };
}

async function runChunk(syncLogId: string, scenario: MockScenario): Promise<void> {
  const syncLog = await prisma.syncLog.findUniqueOrThrow({ where: { id: syncLogId } });
  const result = await processSettlementsChunk(
    { syncLog, cursor: null, workerId: WORKER_ID },
    makeMockFetchers(scenario),
  );
  expect(result.kind).toBe('done');
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('processSettlementsChunk — raw finance-record ingest', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ingests settlement rows in batches', async () => {
    const { storeId, syncLogId } = await buildScenario();

    // 450 Sale rows -> ceil(450 / 200) = 3 ingest batches, each a single transaction.
    const saleRows = Array.from({ length: 450 }, (_, i) => saleRow(`sale-${i}`, BARCODE, 120, 12));
    const txSpy = vi.spyOn(prisma, '$transaction');

    await runChunk(syncLogId, { settlements: { Sale: saleRows } });

    // Every fetched row is stored (distinct record ids), and the store ran exactly one
    // ingest transaction per batch, not one per row.
    expect(
      await prisma.marketplaceFinanceRecord.count({
        where: { storeId, family: FinanceRecordFamily.SETTLEMENT },
      }),
    ).toBe(450);
    expect(txSpy).toHaveBeenCalledTimes(3);
  });

  it('falls back to row-by-row when a batch fails and keeps the good rows', async () => {
    const { storeId, syncLogId } = await buildScenario();
    const errorSpy = vi.spyOn(syncLog, 'error');

    // One row carries a debt beyond numeric(14,2) (1e15 has 16 integer digits), so the
    // batch INSERT raises numeric field overflow and the whole batch transaction fails.
    const badRow = tx({ id: 'sale-bad', debt: 1e15 });
    await runChunk(syncLogId, {
      settlements: {
        Sale: [
          saleRow('sale-ok-1', BARCODE, 120, 12),
          badRow,
          saleRow('sale-ok-2', BARCODE, 130, 13),
        ],
      },
    });

    // The two good rows survive through the row-by-row fallback; the bad row is dropped.
    const stored = await prisma.marketplaceFinanceRecord.findMany({
      where: { storeId, family: FinanceRecordFamily.SETTLEMENT },
      orderBy: { recordId: 'asc' },
    });
    expect(stored.map((row) => row.recordId)).toEqual(['sale-ok-1', 'sale-ok-2']);

    // The batch failure is logged once (with the batch size); the bad row is logged once.
    const batchFailed = errorSpy.mock.calls.filter(
      ([event]) => event === 'settlements.ingest.batch-failed',
    );
    expect(batchFailed).toHaveLength(1);
    expect(batchFailed[0]?.[1]?.['batchSize']).toBe(3);
    const rowFailed = errorSpy.mock.calls.filter(
      ([event]) => event === 'settlements.dispatch.failed',
    );
    expect(rowFailed).toHaveLength(1);
    expect(rowFailed[0]?.[1]?.['rowId']).toBe('sale-bad');
  });

  it('stores every fetched row as a raw finance record and queues the bound orders', async () => {
    const { storeId, orderId, syncLogId } = await buildScenario();

    await runChunk(syncLogId, {
      settlements: { Sale: [saleRow('sale-1', BARCODE, 120, 12)] },
      otherFinancials: { Stoppage: [stoppageRow()] },
    });

    // The Sale (SETTLEMENT) and the Stoppage (OTHER_FINANCIAL) are both stored raw.
    const rows = await prisma.marketplaceFinanceRecord.findMany({ where: { storeId } });
    expect(rows).toHaveLength(2);
    const sale = rows.find((row) => row.family === FinanceRecordFamily.SETTLEMENT);
    expect(sale?.transactionType).toBe('Sale');
    expect(sale?.shipmentPackageId).toBe(SHIPMENT_PACKAGE_ID.toString());
    const stoppage = rows.find((row) => row.family === FinanceRecordFamily.OTHER_FINANCIAL);
    expect(stoppage?.transactionType).toBe('Stoppage');

    // Only the Sale binds an order (the Stoppage is a period row with no package id).
    const queued = await prisma.profitRecomputeRequest.findMany({ where: { storeId } });
    expect(queued).toHaveLength(1);
    expect(queued[0]?.orderId).toBe(orderId);
    expect(queued[0]?.reason).toBe(ProfitRecomputeReason.FINANCE_RECORD);
  });

  it('stores a cargo invoice with all its items in one transaction', async () => {
    const { storeId, syncLogId } = await buildScenario();

    await runChunk(syncLogId, {
      otherFinancials: { DeductionInvoices: [cargoInvoiceRow('INV-1')] },
      cargoItems: [cargoItem(7_000_001, 48.5, 2), cargoItem(7_000_002, 37.25, 1)],
    });

    // The invoice row itself (OTHER_FINANCIAL / DeductionInvoices) plus its two items.
    const invoiceRows = await prisma.marketplaceFinanceRecord.findMany({
      where: { storeId, family: FinanceRecordFamily.OTHER_FINANCIAL },
    });
    expect(invoiceRows).toHaveLength(1);
    expect(invoiceRows[0]?.transactionType).toBe('DeductionInvoices');

    const itemRows = await prisma.marketplaceFinanceRecord.findMany({
      where: { storeId, family: FinanceRecordFamily.CARGO_INVOICE_ITEM },
      orderBy: { recordId: 'asc' },
    });
    expect(itemRows).toHaveLength(2);
    expect(itemRows.map((row) => row.recordId)).toEqual(['INV-1:7000001', 'INV-1:7000002']);
  });

  it('a re-run of the same window stores no duplicate rows', async () => {
    const { storeId, syncLogId } = await buildScenario();

    const scenario: MockScenario = {
      settlements: { Sale: [saleRow('sale-1', BARCODE, 120, 12)] },
      otherFinancials: { DeductionInvoices: [cargoInvoiceRow('INV-1')] },
      cargoItems: [cargoItem(7_000_001, 48.5, 2)],
    };

    await runChunk(syncLogId, scenario);
    // 1 SETTLEMENT + 1 OTHER_FINANCIAL (invoice) + 1 CARGO_INVOICE_ITEM.
    expect(await prisma.marketplaceFinanceRecord.count({ where: { storeId } })).toBe(3);

    await runChunk(syncLogId, scenario);
    // The re-poll updates the same three rows in place — never duplicates them.
    expect(await prisma.marketplaceFinanceRecord.count({ where: { storeId } })).toBe(3);
  });

  it('requests every mapped settlement type', async () => {
    // A default store createdAt (≈now) runs one tiny slice, enough for every type to be
    // requested once. The scan must pull all six settlement types the mapper now maps
    // (Sale, Discount, Return, DiscountCancel, Coupon, CouponCancel) and the three
    // otherfinancials types, so a live coupon or reversal is never silently dropped.
    const { syncLogId } = await buildScenario();
    const requestedSettlements: string[] = [];
    const requestedOtherFinancials: string[] = [];

    const syncLogRow = await prisma.syncLog.findUniqueOrThrow({ where: { id: syncLogId } });
    const result = await processSettlementsChunk(
      { syncLog: syncLogRow, cursor: null, workerId: WORKER_ID },
      {
        fetchSettlements: async function* (
          opts: FetchSettlementsOpts,
        ): AsyncGenerator<TrendyolFinancialTransaction, FinancialScanSummary> {
          requestedSettlements.push(opts.transactionType);
          yield* [];
          return { totalElements: 0, yielded: 0 };
        },
        fetchOtherFinancials: async function* (
          opts: FetchOtherFinancialsOpts,
        ): AsyncGenerator<TrendyolFinancialTransaction, FinancialScanSummary> {
          requestedOtherFinancials.push(opts.transactionType);
          yield* [];
          return { totalElements: 0, yielded: 0 };
        },
        fetchCargoInvoiceItems: async (): Promise<CargoInvoiceItem[]> => [],
      },
    );
    expect(result.kind).toBe('done');

    expect([...new Set(requestedSettlements)].sort()).toEqual(
      ['Coupon', 'CouponCancel', 'Discount', 'DiscountCancel', 'Return', 'Sale'].sort(),
    );
    expect([...new Set(requestedOtherFinancials)].sort()).toEqual(
      ['DeductionInvoices', 'PaymentOrder', 'Stoppage'].sort(),
    );
  });

  it('takes a parcel to SETTLED through raw records and the queue', async () => {
    // A fully-costed melontik parcel so the drain produces a real statement. The order's
    // platform id is numeric so the Sale rows bind it, and its cargo tracking number
    // matches the cargo item's parcel id. The golden sale-cycle + cargo values reconcile
    // the parcel to 191.79, exactly as the direct writer test pins.
    const cargoTracking = 7_331_234_567n;
    const parcel = await seedMelontikParcel({ cargoTrackingNumber: cargoTracking });
    await prisma.order.update({
      where: { id: parcel.orderId },
      data: { platformOrderId: SHIPMENT_PACKAGE_ID.toString() },
    });
    // The melontik helper stores a placeholder credentials blob; the cron decrypts the
    // store's credentials before scanning, so swap in a real encrypted value.
    await prisma.store.update({
      where: { id: parcel.storeId },
      data: {
        credentials: encryptCredentials({ supplierId: '123456', apiKey: 'k', apiSecret: 's' }),
      },
    });
    const syncLog = await createSyncLog(parcel.organizationId, parcel.storeId);

    const a = MELONTIK.items.a;
    const b = MELONTIK.items.b;

    // Step 1: Sale + Discount only (no payment, no cargo) -> PARTIALLY_SETTLED.
    await runChunk(syncLog.id, {
      settlements: {
        Sale: [
          saleRow('sale-a', a.barcode, 529, 100.51),
          saleRow('sale-b', b.barcode, 409.68, 77.84),
        ],
        Discount: [
          discountRow('disc-a', a.barcode, 37.72, 7.17),
          discountRow('disc-b', b.barcode, 29.21, 5.55),
        ],
      },
    });
    const queuedAfterStep1 = await prisma.profitRecomputeRequest.findFirstOrThrow({
      where: { orderId: parcel.orderId },
    });
    expect(queuedAfterStep1.reason).toBe(ProfitRecomputeReason.FINANCE_RECORD);

    await drainProfitRecomputeQueue(prisma, { batchSize: 10 });
    const partial = await prisma.orderProfitStatement.findFirstOrThrow({
      where: { orderId: parcel.orderId, view: ProfitStatementView.BEST_KNOWN },
    });
    expect(partial.status).toBe(ProfitStatus.PARTIALLY_SETTLED);
    expect(partial.netProfit?.toFixed(2)).toBe('191.79');

    // Step 2: the payment order (confirms the sale cycle) + the cargo invoice (actual
    // shipping) -> SETTLED. The stored Sale rows carry the payment order id, so the
    // PaymentOrder row binds this order; the cargo item's parcel id matches the tracking
    // number, so the cargo invoice binds it too.
    await runChunk(syncLog.id, {
      otherFinancials: {
        PaymentOrder: [paymentOrderRow()],
        DeductionInvoices: [cargoInvoiceRow('INV-CARGO-1')],
      },
      cargoItems: [cargoItem(Number(cargoTracking), 98.34, 2)],
    });

    await drainProfitRecomputeQueue(prisma, { batchSize: 10 });
    const settled = await prisma.orderProfitStatement.findFirstOrThrow({
      where: { orderId: parcel.orderId, view: ProfitStatementView.BEST_KNOWN },
    });
    expect(settled.status).toBe(ProfitStatus.SETTLED);
    expect(settled.netProfit?.toFixed(2)).toBe('191.79');
  });

  /** All settlement record ids of the store, sorted, for prune survivor assertions. */
  async function settlementRecordIds(storeId: string): Promise<string[]> {
    const rows = await prisma.marketplaceFinanceRecord.findMany({
      where: { storeId, family: FinanceRecordFamily.SETTLEMENT },
      select: { recordId: true },
    });
    return rows.map((row) => row.recordId).sort();
  }

  it('replaces a renewed record id instead of counting the sale twice', async () => {
    const now = Date.now();
    // A store 14 days old gives a single slice and a non-empty prune window
    // (overallStartTime + 1d .. now - 1d); the sale sits well inside at now - 7d.
    const { storeId, orderId, syncLogId } = await buildScenario({
      storeCreatedAt: new Date(now - 14 * DAY_MS),
    });
    const inside = now - 7 * DAY_MS;

    await runChunk(syncLogId, { settlements: { Sale: [saleRowOn('S-OLD', inside)] } });
    expect(await settlementRecordIds(storeId)).toEqual(['S-OLD']);

    // The same sale comes back under a renewed id: the old row must not linger as a second
    // copy of the same sale.
    await runChunk(syncLogId, { settlements: { Sale: [saleRowOn('S-NEW', inside)] } });

    expect(await settlementRecordIds(storeId)).toEqual(['S-NEW']);
    const queued = await prisma.profitRecomputeRequest.findUnique({ where: { orderId } });
    expect(queued?.reason).toBe(ProfitRecomputeReason.FINANCE_RECORD);
  });

  it('keeps every stored record when a scan comes back short', async () => {
    const now = Date.now();
    const { storeId, syncLogId } = await buildScenario({
      storeCreatedAt: new Date(now - 14 * DAY_MS),
    });
    const inside = now - 7 * DAY_MS;
    const warnSpy = vi.spyOn(syncLog, 'warn');

    await runChunk(syncLogId, { settlements: { Sale: [saleRowOn('S-OLD', inside)] } });

    // Run 2 yields the renewed row but reports more elements than it returned: an
    // incomplete scan must prune nothing, so both ids survive.
    await runChunk(syncLogId, {
      settlements: { Sale: [saleRowOn('S-NEW', inside)] },
      settlementTotals: { Sale: 5 },
    });

    expect(await settlementRecordIds(storeId)).toEqual(['S-NEW', 'S-OLD']);
    const skipped = warnSpy.mock.calls.filter(([event]) => event === 'settlements.prune.skipped');
    expect(
      skipped.some(
        ([, ctx]) => ctx?.['transactionType'] === 'Sale' && ctx?.['reason'] === 'INCOMPLETE_SCAN',
      ),
    ).toBe(true);
  });

  it('skips pruning when the vendor returns a row outside the requested window', async () => {
    const now = Date.now();
    const { storeId, syncLogId } = await buildScenario({
      storeCreatedAt: new Date(now - 14 * DAY_MS),
    });
    const warnSpy = vi.spyOn(syncLog, 'warn');

    await runChunk(syncLogId, { settlements: { Sale: [saleRowOn('S-OLD', now - 7 * DAY_MS)] } });

    // Run 2 returns a row dated two days after the slice end (beyond the 1-day tolerance):
    // the vendor filter is not the field we assumed, so nothing of this type is pruned.
    await runChunk(syncLogId, { settlements: { Sale: [saleRowOn('S-FUTURE', now + 2 * DAY_MS)] } });

    expect(await settlementRecordIds(storeId)).toEqual(['S-FUTURE', 'S-OLD']);
    const skipped = warnSpy.mock.calls.filter(([event]) => event === 'settlements.prune.skipped');
    expect(
      skipped.some(
        ([, ctx]) => ctx?.['transactionType'] === 'Sale' && ctx?.['reason'] === 'OUT_OF_WINDOW_ROW',
      ),
    ).toBe(true);
  });

  it('tolerates a few hours of vendor date shift and still prunes', async () => {
    const now = Date.now();
    const { storeId, syncLogId } = await buildScenario({
      storeCreatedAt: new Date(now - 14 * DAY_MS),
    });

    await runChunk(syncLogId, { settlements: { Sale: [saleRowOn('S-OLD', now - 7 * DAY_MS)] } });

    // Run 2's renewed row is dated three hours after the slice end — inside tolerance — so
    // the window guard holds and pruning still runs, dropping the stale old id.
    await runChunk(syncLogId, {
      settlements: { Sale: [saleRowOn('S-NEW', now + 3 * 60 * 60 * 1000)] },
    });

    expect(await settlementRecordIds(storeId)).toEqual(['S-NEW']);
  });

  it('keeps a stale record within a day of the window edge', async () => {
    const now = Date.now();
    const { storeId, syncLogId } = await buildScenario({
      storeCreatedAt: new Date(now - 14 * DAY_MS),
    });
    // One stale row 12h inside the overall window start (within the 1-day edge pad), one
    // deep inside the prune range.
    const edge = now - 14 * DAY_MS + 12 * 60 * 60 * 1000;
    const deep = now - 7 * DAY_MS;

    await runChunk(syncLogId, {
      settlements: { Sale: [saleRowOn('stale-edge', edge), saleRowOn('stale-deep', deep)] },
    });

    // Run 2 is a complete, empty scan: the deep stale row is pruned, but the one within a
    // day of the window edge sits outside the delete range and is spared.
    await runChunk(syncLogId, { settlements: { Sale: [] } });

    expect(await settlementRecordIds(storeId)).toEqual(['stale-edge']);
  });
});
