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
  ProfitLineCertainty,
  ProfitLineSource,
  ProfitLineType,
  ProfitRecomputeReason,
  ProfitStatementView,
  ProfitStatus,
  ReconciliationStatus,
} from '@pazarsync/db/enums';
import { encryptCredentials, syncLog } from '@pazarsync/sync-core';
import type {
  CargoInvoiceItem,
  FetchCargoInvoiceItemsOpts,
  FetchOtherFinancialsOpts,
  FetchSettlementsOpts,
  FinancialScanSummary,
  MappedOrder,
  TrendyolFinancialTransaction,
} from '@pazarsync/marketplace';
import { upsertOrderWithSnapshot } from '@pazarsync/order-sync';
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

/** A PaymentOrder row dated at an explicit instant (prune tests reuse the base builder). */
function paymentOrderRowOn(id: string, transactionDate: number): TrendyolFinancialTransaction {
  return { ...paymentOrderRow(), id, transactionDate };
}

/** A cargo-invoice DeductionInvoices row dated at an explicit instant (prune tests). */
function cargoInvoiceRowOn(id: string, transactionDate: number): TrendyolFinancialTransaction {
  return { ...cargoInvoiceRow(id), transactionDate };
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

// The settlement/otherfinancials types this mock serves rows for. A type guard over each
// const tuple narrows opts.transactionType (a plain string) to the scenario record's key
// union without a cast; any other requested type yields no rows.
const MOCK_SETTLEMENT_TYPES = ['Sale', 'Discount', 'Return'] as const;
type MockSettlementType = (typeof MOCK_SETTLEMENT_TYPES)[number];
function isMockSettlementType(value: string): value is MockSettlementType {
  return MOCK_SETTLEMENT_TYPES.some((type) => type === value);
}

const MOCK_OTHER_FINANCIAL_TYPES = ['PaymentOrder', 'Stoppage', 'DeductionInvoices'] as const;
type MockOtherFinancialType = (typeof MOCK_OTHER_FINANCIAL_TYPES)[number];
function isMockOtherFinancialType(value: string): value is MockOtherFinancialType {
  return MOCK_OTHER_FINANCIAL_TYPES.some((type) => type === value);
}

function makeMockFetchers(scenario: MockScenario) {
  return {
    fetchSettlements: async function* (
      opts: FetchSettlementsOpts,
    ): AsyncGenerator<TrendyolFinancialTransaction, FinancialScanSummary> {
      const type = opts.transactionType;
      const rows = isMockSettlementType(type) ? (scenario.settlements?.[type] ?? []) : [];
      for (const row of rows) yield row;
      const totalElements = isMockSettlementType(type)
        ? (scenario.settlementTotals?.[type] ?? rows.length)
        : rows.length;
      return { totalElements, yielded: rows.length };
    },
    fetchOtherFinancials: async function* (
      opts: FetchOtherFinancialsOpts,
    ): AsyncGenerator<TrendyolFinancialTransaction, FinancialScanSummary> {
      const type = opts.transactionType;
      const rows = isMockOtherFinancialType(type) ? (scenario.otherFinancials?.[type] ?? []) : [];
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

    // Every fetched row is stored (distinct record ids) in 3 ingest transactions (one per
    // 200-row batch), not one per row. Each non-empty batch is followed by a bind-pass
    // transaction and the run ends with a catch-all bind pass, so the store opened
    // 3 ingest + 4 bind = 7 transactions -- far below the 450 a per-row ingest would open.
    expect(
      await prisma.marketplaceFinanceRecord.count({
        where: { storeId, family: FinanceRecordFamily.SETTLEMENT },
      }),
    ).toBe(450);
    expect(txSpy).toHaveBeenCalledTimes(7);
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

  it('pre-fetches a cargo invoice by its serial and queues the order its item binds by tracking number', async () => {
    // Moved here in phase 5 with the legacy cargo-invoice handler tests. The cargo invoice row is
    // the only input: the cron fetches the invoice items by the row's serial (its id),
    // stores the row and its item raw, and the item's parcel id binds the order through
    // its cargo tracking number -- no settlement row names the order.
    const { storeId, orderId, syncLogId } = await buildScenario();
    const cargoTracking = 7_330_032_270_766_345n;
    await prisma.order.update({
      where: { id: orderId },
      data: { cargoTrackingNumber: cargoTracking },
    });

    const requestedSerials: string[] = [];
    const syncLogRow = await prisma.syncLog.findUniqueOrThrow({ where: { id: syncLogId } });
    const result = await processSettlementsChunk(
      { syncLog: syncLogRow, cursor: null, workerId: WORKER_ID },
      {
        ...makeMockFetchers({
          otherFinancials: { DeductionInvoices: [cargoInvoiceRow('INV-SERIAL-1')] },
        }),
        fetchCargoInvoiceItems: async (
          opts: FetchCargoInvoiceItemsOpts,
        ): Promise<CargoInvoiceItem[]> => {
          requestedSerials.push(opts.invoiceSerialNumber);
          return [cargoItem(Number(cargoTracking), 93.05, 1)];
        },
      },
    );
    expect(result.kind).toBe('done');
    expect([...new Set(requestedSerials)]).toEqual(['INV-SERIAL-1']);

    // The invoice row itself plus its one item are stored raw.
    const invoiceRow = await prisma.marketplaceFinanceRecord.findFirstOrThrow({
      where: { storeId, family: FinanceRecordFamily.OTHER_FINANCIAL },
    });
    expect(invoiceRow.transactionType).toBe('DeductionInvoices');
    const itemRows = await prisma.marketplaceFinanceRecord.findMany({
      where: { storeId, family: FinanceRecordFamily.CARGO_INVOICE_ITEM },
    });
    expect(itemRows.map((row) => row.recordId)).toEqual([
      `INV-SERIAL-1:${cargoTracking.toString()}`,
    ]);

    // The order the cargo item binds to (by tracking number) is enqueued for a recompute.
    const queued = await prisma.profitRecomputeRequest.findUniqueOrThrow({ where: { orderId } });
    expect(queued.reason).toBe(ProfitRecomputeReason.FINANCE_RECORD);
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

  it('a second identical cron run enqueues no order', async () => {
    // A fully-costed melontik parcel so the drain produces a statement and empties the
    // queue (a bare order would leave a non-computable row behind). Its platform id is set
    // numeric so the Sale rows bind it; real credentials replace the helper's placeholder.
    const parcel = await seedMelontikParcel();
    await prisma.order.update({
      where: { id: parcel.orderId },
      data: { platformOrderId: SHIPMENT_PACKAGE_ID.toString() },
    });
    await prisma.store.update({
      where: { id: parcel.storeId },
      data: {
        credentials: encryptCredentials({ supplierId: '123456', apiKey: 'k', apiSecret: 's' }),
      },
    });
    const syncLog = await createSyncLog(parcel.organizationId, parcel.storeId);
    const a = MELONTIK.items.a;
    const b = MELONTIK.items.b;
    const scenario: MockScenario = {
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
    };

    // First run stores the rows, binds them and enqueues the order; drain empties the queue.
    await runChunk(syncLog.id, scenario);
    await drainProfitRecomputeQueue(prisma, { batchSize: 10 });
    expect(await prisma.profitRecomputeRequest.count()).toBe(0);

    // A second identical run finds every row unchanged: nothing is flagged, so the bind
    // pass enqueues no recompute and the queue stays empty.
    await runChunk(syncLog.id, scenario);
    expect(await prisma.profitRecomputeRequest.count()).toBe(0);
    // Sanity: the order itself still exists; the empty queue is not a cascade delete.
    expect(await prisma.order.findUnique({ where: { id: parcel.orderId } })).not.toBeNull();
  });

  it("a run where one record changed enqueues only that record's order", async () => {
    const { storeId, organizationId, orderId, syncLogId } = await buildScenario();

    // A second order bound by its own shipment package, plus a sale row that names it.
    const SHIPMENT_PACKAGE_ID_2 = 444_555_777;
    const order2 = await prisma.order.create({
      data: {
        organizationId,
        storeId,
        platformOrderId: SHIPMENT_PACKAGE_ID_2.toString(),
        orderDate: new Date(),
        status: 'DELIVERED',
        saleGross: new Decimal('200.00'),
        saleVat: new Decimal('33.33'),
      },
    });
    const sale2 = (credit: number, commissionAmount: number): TrendyolFinancialTransaction =>
      tx({
        id: 'sale-2',
        transactionType: 'Satış',
        barcode: BARCODE,
        credit,
        commissionAmount,
        shipmentPackageId: SHIPMENT_PACKAGE_ID_2,
        paymentOrderId: PAYMENT_ORDER_ID,
      });

    // First run: both sales stored, both orders bound and enqueued; clear the queue.
    await runChunk(syncLogId, {
      settlements: { Sale: [saleRow('sale-1', BARCODE, 120, 12), sale2(200, 20)] },
    });
    await prisma.profitRecomputeRequest.deleteMany({});

    // Second run: sale-1's amount changed, sale-2 is identical. Only the changed row is
    // flagged, so the bind pass enqueues only its order (order1), never order2.
    await runChunk(syncLogId, {
      settlements: { Sale: [saleRow('sale-1', BARCODE, 150, 15), sale2(200, 20)] },
    });
    const queued = await prisma.profitRecomputeRequest.findMany({ where: { storeId } });
    expect(queued).toHaveLength(1);
    expect(queued[0]?.orderId).toBe(orderId);
    expect(queued.map((row) => row.orderId)).not.toContain(order2.id);
  });

  it('requests every mapped settlement type', async () => {
    // A default store createdAt (~now) runs one tiny slice, enough for every type to be
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

  it("a settlement stored before its order exists reaches the order's profit once the order arrives", async () => {
    // The fully-costed melontik setup (costed variant + fee definitions), but the order is
    // removed so the Sale's shipment package has NO order when the cron runs. Its cost
    // version is effective well before the order day, so the 3E rule never excludes it --
    // exactly how the SETTLED test's costed parcel stays computable. The cron decrypts the
    // store credentials, so swap in a real encrypted value like that test does.
    const parcel = await seedMelontikParcel();
    await prisma.order.delete({ where: { id: parcel.orderId } });
    await prisma.store.update({
      where: { id: parcel.storeId },
      data: {
        credentials: encryptCredentials({ supplierId: '123456', apiKey: 'k', apiSecret: 's' }),
      },
    });
    const syncLog = await createSyncLog(parcel.organizationId, parcel.storeId);
    const a = MELONTIK.items.a;

    // Path 1 (bind pass): the Sale for SHIPMENT_PACKAGE_ID is ingested while no order with
    // that platform id exists. The bind pass clears bind_pending and finds no order, so it
    // enqueues nothing -- the record is NOT left flagged for a later pass to re-pick.
    await runChunk(syncLog.id, {
      settlements: { Sale: [saleRow('sale-a', a.barcode, 529, 100.51)] },
    });
    const storedRows = await prisma.marketplaceFinanceRecord.findMany({
      where: { storeId: parcel.storeId, family: FinanceRecordFamily.SETTLEMENT },
    });
    expect(storedRows).toHaveLength(1);
    const saleRecord = storedRows[0];
    expect(saleRecord?.bindPending).toBe(false);
    expect(saleRecord?.credit?.toFixed(2)).toBe('529.00');
    expect(await prisma.profitRecomputeRequest.count()).toBe(0);

    // Path 2 (order-create enqueue): the order arrives through the same intake the worker
    // uses (upsertOrderWithSnapshot). Its create-time ORDER_CHANGED recompute is the ONLY
    // path that reaches the already-stored settlement.
    const mapped: MappedOrder = {
      platformOrderId: SHIPMENT_PACKAGE_ID.toString(),
      platformOrderNumber: `ord-${SHIPMENT_PACKAGE_ID}`,
      orderDate: MELONTIK.orderDate,
      lastModifiedDate: MELONTIK.orderDate,
      status: 'DELIVERED',
      dematerialized: false,
      packagePending: false,
      saleGross: a.saleGross,
      saleVat: '44.66',
      listGross: a.listGross,
      sellerDiscountGross: a.sellerDiscountGross,
      promotionDisplays: null,
      agreedDeliveryDate: null,
      actualDeliveryDate: null,
      actualShipDate: null,
      fastDelivery: false,
      fastDeliveryType: null,
      isExportSale: false,
      estimatedDeliveryStartDate: null,
      estimatedDeliveryEndDate: null,
      cargoProviderName: null,
      cargoTrackingNumber: null,
      cargoDeci: null,
      usesSellerCargoAgreement: false,
      platformCreatedBy: null,
      originShipmentDate: null,
      lines: [
        {
          barcode: a.barcode,
          quantity: 1,
          platformLineId: '7001',
          lineListGross: a.listGross,
          lineSaleGross: a.saleGross,
          lineSellerDiscountGross: a.sellerDiscountGross,
          saleVatRate: a.saleVatRate,
          commissionRate: a.commissionRate,
          commissionKnown: true,
        },
      ],
    };
    await upsertOrderWithSnapshot(parcel.storeId, parcel.organizationId, mapped);

    const order = await prisma.order.findFirstOrThrow({
      where: { storeId: parcel.storeId, platformOrderId: SHIPMENT_PACKAGE_ID.toString() },
    });
    const queued = await prisma.profitRecomputeRequest.findMany({
      where: { storeId: parcel.storeId },
    });
    expect(queued).toHaveLength(1);
    expect(queued[0]?.orderId).toBe(order.id);
    expect(queued[0]?.reason).toBe(ProfitRecomputeReason.ORDER_CHANGED);

    // Draining that recompute loads the stored Sale and lands it as a settlement-sourced
    // SALE actual, moving the order off NOT_SETTLED.
    await drainProfitRecomputeQueue(prisma, { batchSize: 10 });
    const statement = await prisma.orderProfitStatement.findFirstOrThrow({
      where: { orderId: order.id, view: ProfitStatementView.BEST_KNOWN },
    });
    expect(statement.reconciliationStatus).not.toBe(ReconciliationStatus.NOT_SETTLED);

    const saleActual = await prisma.profitLine.findFirstOrThrow({
      where: {
        orderId: order.id,
        type: ProfitLineType.SALE,
        certainty: ProfitLineCertainty.ACTUAL,
        source: ProfitLineSource.MARKETPLACE_RECORD,
      },
    });
    const recordCredit = saleRecord?.credit;
    if (recordCredit === null || recordCredit === undefined) {
      throw new Error('expected the stored Sale record to carry a credit');
    }
    // The SALE actual equals the stored Sale record's credit (529.00), decimal-exact.
    expect(
      new Decimal(saleActual.amountGross.toFixed()).equals(new Decimal(recordCredit.toFixed())),
    ).toBe(true);
    expect(saleActual.amountGross.toFixed(2)).toBe('529.00');
  });

  /** Record ids of the store in one family, sorted, for prune survivor assertions. */
  async function recordIdsByFamily(
    storeId: string,
    family: FinanceRecordFamily,
  ): Promise<string[]> {
    const rows = await prisma.marketplaceFinanceRecord.findMany({
      where: { storeId, family },
      select: { recordId: true },
    });
    return rows.map((row) => row.recordId).sort();
  }

  /** All settlement record ids of the store, sorted, for prune survivor assertions. */
  async function settlementRecordIds(storeId: string): Promise<string[]> {
    return recordIdsByFamily(storeId, FinanceRecordFamily.SETTLEMENT);
  }

  /** All other-financial record ids of the store, sorted. */
  async function otherFinancialRecordIds(storeId: string): Promise<string[]> {
    return recordIdsByFamily(storeId, FinanceRecordFamily.OTHER_FINANCIAL);
  }

  /** All cargo-invoice-item record ids of the store, sorted. */
  async function cargoItemRecordIds(storeId: string): Promise<string[]> {
    return recordIdsByFamily(storeId, FinanceRecordFamily.CARGO_INVOICE_ITEM);
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

  it('reports the incomplete scan first when several prune conditions fail', async () => {
    const now = Date.now();
    const { storeId, syncLogId } = await buildScenario({
      storeCreatedAt: new Date(now - 14 * DAY_MS),
    });
    const inside = now - 7 * DAY_MS;
    const warnSpy = vi.spyOn(syncLog, 'warn');

    await runChunk(syncLogId, { settlements: { Sale: [saleRowOn('S-OLD', inside)] } });

    // Run 2's single row trips two prune guards at once: it is dated two days after the
    // slice end (out of window) AND the scan reports more elements than it returned (an
    // incomplete scan). The guards run in a fixed precedence, so the incomplete scan is
    // reported first: the stale old row stays and a single skip is logged with reason
    // INCOMPLETE_SCAN, never OUT_OF_WINDOW_ROW.
    await runChunk(syncLogId, {
      settlements: { Sale: [saleRowOn('S-FUTURE', now + 2 * DAY_MS)] },
      settlementTotals: { Sale: 5 },
    });

    expect(await settlementRecordIds(storeId)).toEqual(['S-FUTURE', 'S-OLD']);
    const skippedForSale = warnSpy.mock.calls.filter(
      ([event, ctx]) =>
        event === 'settlements.prune.skipped' && ctx?.['transactionType'] === 'Sale',
    );
    expect(skippedForSale).toHaveLength(1);
    expect(skippedForSale[0]?.[1]?.['reason']).toBe('INCOMPLETE_SCAN');
  });

  it('tolerates a few hours of vendor date shift and still prunes', async () => {
    const now = Date.now();
    const { storeId, syncLogId } = await buildScenario({
      storeCreatedAt: new Date(now - 14 * DAY_MS),
    });

    await runChunk(syncLogId, { settlements: { Sale: [saleRowOn('S-OLD', now - 7 * DAY_MS)] } });

    // Run 2's renewed row is dated three hours after the slice end -- inside tolerance -- so
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

    // Run 2 returns one fresh in-window row, so the scan is non-empty and pruning runs (an
    // empty scan would now be left untouched). The deep stale row is dropped, but the one
    // within a day of the window edge sits outside the delete range and is spared, and the
    // fresh row the scan saw survives.
    await runChunk(syncLogId, { settlements: { Sale: [saleRowOn('S-FRESH', deep)] } });

    expect(await settlementRecordIds(storeId)).toEqual(['S-FRESH', 'stale-edge']);
  });

  it('prunes a renewed payment order record and enqueues the orders it settled', async () => {
    const now = Date.now();
    const { storeId, orderId, syncLogId } = await buildScenario({
      storeCreatedAt: new Date(now - 14 * DAY_MS),
    });
    const inside = now - 7 * DAY_MS;

    // Run 1 stores the sale (carrying the payment order id) and the payment order row that
    // binds the order through it.
    await runChunk(syncLogId, {
      settlements: { Sale: [saleRowOn('S-1', inside)] },
      otherFinancials: { PaymentOrder: [paymentOrderRowOn('PO-OLD', inside)] },
    });
    expect(await otherFinancialRecordIds(storeId)).toEqual(['PO-OLD']);
    await prisma.profitRecomputeRequest.deleteMany({});

    // The same payment order comes back under a renewed id. The stored sale rows stay (an
    // empty settlement scan never wipes them), so the old payment-order row is the only
    // stale row this window: it is pruned and the order it settled is enqueued.
    await runChunk(syncLogId, {
      otherFinancials: { PaymentOrder: [paymentOrderRowOn('PO-NEW', inside)] },
    });

    expect(await otherFinancialRecordIds(storeId)).toEqual(['PO-NEW']);
    expect(await settlementRecordIds(storeId)).toEqual(['S-1']);
    const queued = await prisma.profitRecomputeRequest.findUnique({ where: { orderId } });
    expect(queued?.reason).toBe(ProfitRecomputeReason.FINANCE_RECORD);
  });

  it('prunes a renewed cargo invoice row but keeps its items', async () => {
    const now = Date.now();
    const { storeId, syncLogId } = await buildScenario({
      storeCreatedAt: new Date(now - 14 * DAY_MS),
    });
    const inside = now - 7 * DAY_MS;

    // Run 1 stores the cargo invoice row (OTHER_FINANCIAL / DeductionInvoices) and its item.
    await runChunk(syncLogId, {
      otherFinancials: { DeductionInvoices: [cargoInvoiceRowOn('INV-OLD', inside)] },
      cargoItems: [cargoItem(7_000_001, 48.5, 2)],
    });

    // The invoice comes back under a renewed id with its item.
    await runChunk(syncLogId, {
      otherFinancials: { DeductionInvoices: [cargoInvoiceRowOn('INV-NEW', inside)] },
      cargoItems: [cargoItem(7_000_001, 48.5, 2)],
    });

    // The stale invoice row is pruned; the cargo items (a never-pruned family) all remain,
    // including the one the old invoice stored.
    expect(await otherFinancialRecordIds(storeId)).toEqual(['INV-NEW']);
    expect(await cargoItemRecordIds(storeId)).toEqual(['INV-NEW:7000001', 'INV-OLD:7000001']);
  });

  it('keeps the stale record when a renewed row fails to ingest', async () => {
    const now = Date.now();
    const { storeId, syncLogId } = await buildScenario({
      storeCreatedAt: new Date(now - 14 * DAY_MS),
    });
    const inside = now - 7 * DAY_MS;
    const warnSpy = vi.spyOn(syncLog, 'warn');

    await runChunk(syncLogId, { settlements: { Sale: [saleRowOn('S-OLD', inside)] } });

    // Run 2's renewed row carries a debt beyond numeric(14,2), so both the batch and the
    // row-by-row retry fail to ingest it. The type must not be pruned -- otherwise the stale
    // old row would be deleted while the renewed row was never stored, leaving the sale with
    // no record at all until the next cycle.
    const badRow = tx({
      id: 'S-NEW',
      barcode: BARCODE,
      debt: 1e15,
      shipmentPackageId: SHIPMENT_PACKAGE_ID,
      transactionDate: inside,
    });
    await runChunk(syncLogId, { settlements: { Sale: [badRow] } });

    expect(await settlementRecordIds(storeId)).toEqual(['S-OLD']);
    const skipped = warnSpy.mock.calls.filter(([event]) => event === 'settlements.prune.skipped');
    expect(
      skipped.some(
        ([, ctx]) => ctx?.['transactionType'] === 'Sale' && ctx?.['reason'] === 'INGEST_FAILED',
      ),
    ).toBe(true);
  });

  it('still prunes when a failed batch recovers row by row', async () => {
    const now = Date.now();
    const { storeId, syncLogId } = await buildScenario({
      storeCreatedAt: new Date(now - 14 * DAY_MS),
    });
    const inside = now - 7 * DAY_MS;

    // Run 1 stores the sale under its old id.
    await runChunk(syncLogId, { settlements: { Sale: [saleRowOn('S-OLD', inside)] } });
    expect(await settlementRecordIds(storeId)).toEqual(['S-OLD']);

    const errorSpy = vi.spyOn(syncLog, 'error');
    const warnSpy = vi.spyOn(syncLog, 'warn');
    // Run 2's first ingest transaction (the Sale batch) fails once, then the row-by-row retry
    // runs against the real transaction and stores the renewed row. A batch that fails but
    // whose rows all recover row by row must NOT mark the type ingestFailed (the flag is set
    // only in the per-row catch), so pruning still runs.
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('transient batch failure'));

    await runChunk(syncLogId, { settlements: { Sale: [saleRowOn('S-NEW', inside)] } });

    // The batch failed once (the fallback path was exercised) and the renewed row ingested.
    const batchFailed = errorSpy.mock.calls.filter(
      ([event]) => event === 'settlements.ingest.batch-failed',
    );
    expect(batchFailed).toHaveLength(1);

    // The renewed row recovered, so the stale old id is pruned and no INGEST_FAILED skip is
    // logged for this type.
    expect(await settlementRecordIds(storeId)).toEqual(['S-NEW']);
    const skipped = warnSpy.mock.calls.filter(([event]) => event === 'settlements.prune.skipped');
    expect(
      skipped.some(
        ([, ctx]) => ctx?.['transactionType'] === 'Sale' && ctx?.['reason'] === 'INGEST_FAILED',
      ),
    ).toBe(false);
  });

  it('does not prune a type whose complete scan came back empty while rows are stored', async () => {
    const now = Date.now();
    const { storeId, syncLogId } = await buildScenario({
      storeCreatedAt: new Date(now - 14 * DAY_MS),
    });
    const inside = now - 7 * DAY_MS;
    const warnSpy = vi.spyOn(syncLog, 'warn');

    await runChunk(syncLogId, { settlements: { Sale: [saleRowOn('S-OLD', inside)] } });

    // Run 2 is a complete scan that returned no Sale rows at all. A transient empty vendor
    // response must not wipe every stored Sale row, so the type is left untouched and the
    // skip is logged with the count still stored in the window.
    await runChunk(syncLogId, { settlements: { Sale: [] } });

    expect(await settlementRecordIds(storeId)).toEqual(['S-OLD']);
    const skipped = warnSpy.mock.calls.filter(([event]) => event === 'settlements.prune.skipped');
    const emptyScan = skipped.find(
      ([, ctx]) => ctx?.['transactionType'] === 'Sale' && ctx?.['reason'] === 'EMPTY_SCAN',
    );
    expect(emptyScan).toBeDefined();
    expect(emptyScan?.[1]?.['storedCount']).toBe(1);
  });
});
