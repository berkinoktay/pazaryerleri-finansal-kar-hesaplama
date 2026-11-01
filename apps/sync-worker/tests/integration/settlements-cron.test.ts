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

interface SimpleCtx {
  storeId: string;
  organizationId: string;
  orderId: string;
  syncLogId: string;
}

/** A store + a single numeric-platformOrderId order + a SETTLEMENTS syncLog claimed here. */
async function buildScenario(): Promise<SimpleCtx> {
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
}

function makeMockFetchers(scenario: MockScenario) {
  return {
    fetchSettlements: async function* (
      opts: FetchSettlementsOpts,
    ): AsyncGenerator<TrendyolFinancialTransaction, void> {
      const rows = scenario.settlements?.[opts.transactionType as 'Sale' | 'Discount' | 'Return'];
      if (!rows) return;
      for (const row of rows) yield row;
    },
    fetchOtherFinancials: async function* (
      opts: FetchOtherFinancialsOpts,
    ): AsyncGenerator<TrendyolFinancialTransaction, void> {
      const rows =
        scenario.otherFinancials?.[
          opts.transactionType as 'PaymentOrder' | 'Stoppage' | 'DeductionInvoices'
        ];
      if (!rows) return;
      for (const row of rows) yield row;
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
});
