/**
 * Integration tests for the raw finance-record ingest (Phase 3B, Gorev 6). They run
 * against the isolated test database. They pin that rows are stored idempotently on
 * the (store, family, record_id) key, that a sale row is updated in place when its
 * payment order arrives later, that a cargo item keeps one row when a re-scan relabels
 * it, that a row for a not-yet-existing order is still stored while enqueuing nothing,
 * that the enqueued order set equals exactly what the loader would bind, that a sibling
 * store's order sharing the keys is never enqueued, and that a store/organization
 * mismatch stores and enqueues nothing.
 *
 * Requires: `supabase start` + `pnpm db:push` before running.
 */

import { randomUUID } from 'node:crypto';

import { prisma } from '@pazarsync/db';
import { FinanceRecordFamily, Platform, ProfitRecomputeReason } from '@pazarsync/db/enums';
import type { CargoInvoiceItem, TrendyolFinancialTransaction } from '@pazarsync/marketplace';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { FinanceRecordInput } from '../../core/finance-record-input';
import {
  trendyolCargoInvoiceItemInputs,
  trendyolOtherFinancialRecordInput,
  trendyolSettlementRecordInput,
} from '../../marketplaces/trendyol/finance-record-inputs';
import {
  TRENDYOL_CARGO_OUTBOUND_ITEM_TYPE,
  TRENDYOL_CARGO_RETURN_ITEM_TYPE,
} from '../../marketplaces/trendyol/settlement-records';
import { ingestFinanceRecords, pruneUnseenFinanceRecords } from '../finance-records';
import { loadTrendyolParcel } from '../load-trendyol-parcel';
import {
  createAdditionalStore,
  createTrendyolOrg,
  ensureDbReachable,
  insertFinanceRecord,
  MELONTIK,
  seedMelontikParcel,
  truncateAll,
  upsertMelontikCarrier,
} from './helpers/melontik-parcel';

const TX_MS = Date.parse('2026-10-28T09:00:00.000Z');

const BASE_TX: TrendyolFinancialTransaction = {
  id: 'rec-1',
  transactionDate: TX_MS,
  barcode: null,
  transactionType: 'Satis',
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
  sellerId: 1,
  storeId: null,
  storeName: null,
  storeAddress: null,
  country: 'TR',
  orderDate: null,
  affiliate: '',
  shipmentPackageId: null,
};

function financialTx(
  overrides: Partial<TrendyolFinancialTransaction> & { readonly id: string },
): TrendyolFinancialTransaction {
  return { ...BASE_TX, ...overrides };
}

const BASE_CARGO: CargoInvoiceItem = {
  shipmentPackageType: TRENDYOL_CARGO_OUTBOUND_ITEM_TYPE,
  parcelUniqueId: 0,
  orderNumber: '',
  amount: 0,
  desi: 0,
};

function cargoItem(overrides: Partial<CargoInvoiceItem>): CargoInvoiceItem {
  return { ...BASE_CARGO, ...overrides };
}

/** Creates one bare Trendyol order with an explicit platform order id and cargo number. */
async function createTestOrder(params: {
  readonly organizationId: string;
  readonly storeId: string;
  readonly platformOrderId: string;
  readonly cargoTrackingNumber?: bigint | null;
}): Promise<string> {
  const order = await prisma.order.create({
    data: {
      organizationId: params.organizationId,
      storeId: params.storeId,
      platformOrderId: params.platformOrderId,
      orderDate: MELONTIK.orderDate,
      status: 'DELIVERED',
      micro: false,
      fastDelivery: false,
      fastDeliveryType: null,
      usesSellerCargoAgreement: false,
      cargoTrackingNumber: params.cargoTrackingNumber ?? null,
    },
  });
  return order.id;
}

/** Attaches one claim to an order, carrying a return package id and/or cargo number. */
async function seedClaim(params: {
  readonly organizationId: string;
  readonly storeId: string;
  readonly orderId: string;
  readonly orderShipmentPackageId?: string | null;
  readonly cargoTrackingNumber?: bigint | null;
}): Promise<void> {
  await prisma.orderClaim.create({
    data: {
      organizationId: params.organizationId,
      storeId: params.storeId,
      orderId: params.orderId,
      trendyolClaimId: `claim-${randomUUID().slice(0, 8)}`,
      claimDate: new Date('2026-10-29T00:00:00Z'),
      resolved: false,
      orderShipmentPackageId: params.orderShipmentPackageId ?? null,
      cargoTrackingNumber: params.cargoTrackingNumber ?? null,
    },
  });
}

/** The queue rows (by order), sorted, for enqueue assertions. */
async function queuedOrderIds(): Promise<string[]> {
  const rows = await prisma.profitRecomputeRequest.findMany({ select: { orderId: true } });
  return rows.map((row) => row.orderId).sort();
}

describe('ingestFinanceRecords', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('stores settlement, other-financial and cargo rows idempotently', async () => {
    const parcel = await seedMelontikParcel();
    const invoiceRow = financialTx({ id: 'INV-1', transactionType: 'Kargo Fatura' });
    const records: FinanceRecordInput[] = [
      trendyolSettlementRecordInput(
        'Sale',
        financialTx({ id: 'sale-a', shipmentPackageId: 1001, credit: 529, paymentOrderId: 9009 }),
      ),
      trendyolSettlementRecordInput(
        'Discount',
        financialTx({ id: 'disc-a', shipmentPackageId: 1001, debt: 37.72 }),
      ),
      trendyolOtherFinancialRecordInput(
        'PaymentOrder',
        financialTx({ id: 'po-1', paymentOrderId: 9009 }),
      ),
      ...trendyolCargoInvoiceItemInputs(invoiceRow, [
        cargoItem({ parcelUniqueId: 3003, amount: 98.34, desi: 2 }),
      ]),
    ];

    const first = await ingestFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platform: Platform.TRENDYOL,
      records,
    });
    expect(first.stored).toBe(4);
    expect(await prisma.marketplaceFinanceRecord.count()).toBe(4);

    const second = await ingestFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platform: Platform.TRENDYOL,
      records,
    });
    expect(second.stored).toBe(4);
    // The second ingest updated the same four rows; it never duplicated them.
    expect(await prisma.marketplaceFinanceRecord.count()).toBe(4);
  });

  it('updates a sale row when it is re-fetched with its payment order', async () => {
    const parcel = await seedMelontikParcel();
    const order = await createTestOrder({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platformOrderId: '1001',
    });

    const first = await ingestFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platform: Platform.TRENDYOL,
      records: [
        trendyolSettlementRecordInput(
          'Sale',
          financialTx({ id: 'sale-a', shipmentPackageId: 1001, credit: 529 }),
        ),
      ],
    });
    expect(first.stored).toBe(1);
    expect(first.enqueuedOrders).toBe(1);
    const before = await prisma.marketplaceFinanceRecord.findFirstOrThrow({
      where: { recordId: 'sale-a' },
    });
    expect(before.paymentOrderId).toBeNull();
    expect(await queuedOrderIds()).toEqual([order]);

    // Simulate the drain clearing the queue, then the window re-polls with the payment order.
    await prisma.profitRecomputeRequest.deleteMany({});

    const second = await ingestFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platform: Platform.TRENDYOL,
      records: [
        trendyolSettlementRecordInput(
          'Sale',
          financialTx({ id: 'sale-a', shipmentPackageId: 1001, credit: 529, paymentOrderId: 9009 }),
        ),
        trendyolOtherFinancialRecordInput(
          'PaymentOrder',
          financialTx({ id: 'po-1', paymentOrderId: 9009 }),
        ),
      ],
    });
    expect(second.enqueuedOrders).toBe(1);

    const after = await prisma.marketplaceFinanceRecord.findFirstOrThrow({
      where: { recordId: 'sale-a' },
    });
    expect(after.paymentOrderId).toBe('9009');
    expect(after.id).toBe(before.id); // same row, updated in place
    expect(await prisma.marketplaceFinanceRecord.count()).toBe(2);
    expect(await queuedOrderIds()).toEqual([order]);
  });

  it('keeps one cargo row when a re-scan relabels the item', async () => {
    const parcel = await seedMelontikParcel();
    const invoiceRow = financialTx({ id: 'INV-1', transactionType: 'Kargo Fatura' });

    await ingestFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platform: Platform.TRENDYOL,
      records: trendyolCargoInvoiceItemInputs(invoiceRow, [
        cargoItem({
          shipmentPackageType: TRENDYOL_CARGO_OUTBOUND_ITEM_TYPE,
          parcelUniqueId: 3003,
          amount: 98.34,
          desi: 2,
        }),
      ]),
    });
    expect(await prisma.marketplaceFinanceRecord.count()).toBe(1);

    await ingestFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platform: Platform.TRENDYOL,
      records: trendyolCargoInvoiceItemInputs(invoiceRow, [
        cargoItem({
          shipmentPackageType: TRENDYOL_CARGO_RETURN_ITEM_TYPE,
          parcelUniqueId: 3003,
          amount: 98.34,
          desi: 2,
        }),
      ]),
    });

    const rows = await prisma.marketplaceFinanceRecord.findMany({
      where: { family: FinanceRecordFamily.CARGO_INVOICE_ITEM },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.transactionType).toBe(TRENDYOL_CARGO_RETURN_ITEM_TYPE);
    expect(rows[0]?.recordId).toBe('INV-1:3003');
  });

  it('collapses records that repeat the same id in one call', async () => {
    const parcel = await seedMelontikParcel();
    const invoiceRow = financialTx({ id: 'INV-1', transactionType: 'Kargo Fatura' });
    // Two cargo items share the same parcelUniqueId, so both map to the same
    // (family, recordId) = CARGO_INVOICE_ITEM / "INV-1:3003". Without in-call dedup the
    // single INSERT ... ON CONFLICT would carry that key twice and Postgres would abort
    // the whole invoice.
    const records = trendyolCargoInvoiceItemInputs(invoiceRow, [
      cargoItem({
        shipmentPackageType: TRENDYOL_CARGO_OUTBOUND_ITEM_TYPE,
        parcelUniqueId: 3003,
        amount: 10,
        desi: 1,
      }),
      cargoItem({
        shipmentPackageType: TRENDYOL_CARGO_RETURN_ITEM_TYPE,
        parcelUniqueId: 3003,
        amount: 98.34,
        desi: 2,
      }),
    ]);

    const result = await ingestFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platform: Platform.TRENDYOL,
      records,
    });

    // One row per parcel, carrying the LAST item's values, and the call did not throw.
    expect(result.stored).toBe(1);
    const rows = await prisma.marketplaceFinanceRecord.findMany({
      where: { family: FinanceRecordFamily.CARGO_INVOICE_ITEM },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.recordId).toBe('INV-1:3003');
    expect(rows[0]?.transactionType).toBe(TRENDYOL_CARGO_RETURN_ITEM_TYPE);
    expect(rows[0]?.amountGross?.toFixed(2)).toBe('98.34');
    expect(rows[0]?.desi?.toFixed(2)).toBe('2.00');
  });

  it('keeps records of different families that share a record id apart', async () => {
    const parcel = await seedMelontikParcel();
    // A settlement row and an otherfinancials row can carry the same vendor id; only
    // (family, recordId) together form the conflict key, so both must survive as two
    // distinct rows rather than collapsing onto one.
    const sharedId = 'shared-rec-1';
    const records: FinanceRecordInput[] = [
      trendyolSettlementRecordInput(
        'Sale',
        financialTx({ id: sharedId, shipmentPackageId: 1001, credit: 529 }),
      ),
      trendyolOtherFinancialRecordInput(
        'PaymentOrder',
        financialTx({ id: sharedId, paymentOrderId: 9009 }),
      ),
    ];

    const result = await ingestFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platform: Platform.TRENDYOL,
      records,
    });

    expect(result.stored).toBe(2);
    const rows = await prisma.marketplaceFinanceRecord.findMany({
      where: { storeId: parcel.storeId, recordId: sharedId },
    });
    expect(rows).toHaveLength(2);
    const families = rows.map((row) => row.family).sort();
    expect(families).toEqual([FinanceRecordFamily.OTHER_FINANCIAL, FinanceRecordFamily.SETTLEMENT]);
  });

  it('stores a row whose order does not exist yet and enqueues nothing', async () => {
    const parcel = await seedMelontikParcel();

    const result = await ingestFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platform: Platform.TRENDYOL,
      records: [
        trendyolSettlementRecordInput(
          'Sale',
          financialTx({ id: 'sale-orphan', shipmentPackageId: 999999, credit: 100 }),
        ),
      ],
    });

    expect(result.stored).toBe(1);
    expect(result.enqueuedOrders).toBe(0);
    expect(await prisma.marketplaceFinanceRecord.count()).toBe(1);
    expect(await queuedOrderIds()).toEqual([]);
  });

  it('enqueues exactly the orders the loader would bind the records to', async () => {
    const parcel = await seedMelontikParcel();
    const org = parcel.organizationId;
    const store = parcel.storeId;

    const order1 = await createTestOrder({
      organizationId: org,
      storeId: store,
      platformOrderId: '1001',
    });
    const order2 = await createTestOrder({
      organizationId: org,
      storeId: store,
      platformOrderId: '1002',
    });
    await seedClaim({
      organizationId: org,
      storeId: store,
      orderId: order2,
      orderShipmentPackageId: '2002',
    });
    const order3 = await createTestOrder({
      organizationId: org,
      storeId: store,
      platformOrderId: '1003',
      cargoTrackingNumber: 3003n,
    });
    const order4 = await createTestOrder({
      organizationId: org,
      storeId: store,
      platformOrderId: '1004',
    });
    await seedClaim({
      organizationId: org,
      storeId: store,
      orderId: order4,
      cargoTrackingNumber: 4004n,
    });
    const orderDecoy = await createTestOrder({
      organizationId: org,
      storeId: store,
      platformOrderId: '1005',
      cargoTrackingNumber: 5005n,
    });

    const invoiceRow = financialTx({ id: 'INV-1', transactionType: 'Kargo Fatura' });
    const records: FinanceRecordInput[] = [
      // Outbound package -> order1 directly; return package -> order2 via its claim.
      trendyolSettlementRecordInput(
        'Sale',
        financialTx({ id: 'sale-1', shipmentPackageId: 1001, credit: 529, paymentOrderId: 9009 }),
      ),
      trendyolSettlementRecordInput(
        'Return',
        financialTx({ id: 'ret-2', shipmentPackageId: 2002, debt: 50, paymentOrderId: 9009 }),
      ),
      // Payment order -> the two orders bound to those settlements.
      trendyolOtherFinancialRecordInput(
        'PaymentOrder',
        financialTx({ id: 'po-1', paymentOrderId: 9009 }),
      ),
      // Outbound cargo -> order3; return cargo -> order4 via its claim's tracking number.
      ...trendyolCargoInvoiceItemInputs(invoiceRow, [
        cargoItem({
          shipmentPackageType: TRENDYOL_CARGO_OUTBOUND_ITEM_TYPE,
          parcelUniqueId: 3003,
          amount: 98.34,
          desi: 2,
        }),
        cargoItem({
          shipmentPackageType: TRENDYOL_CARGO_RETURN_ITEM_TYPE,
          parcelUniqueId: 4004,
          amount: 44.4,
          desi: 1,
        }),
      ]),
    ];

    const result = await ingestFinanceRecords(prisma, {
      organizationId: org,
      storeId: store,
      platform: Platform.TRENDYOL,
      records,
    });
    expect(result.stored).toBe(5);
    expect(result.enqueuedOrders).toBe(4);

    const expected = [order1, order2, order3, order4].sort();
    expect(await queuedOrderIds()).toEqual(expected);

    // The queued set equals exactly the orders the loader would hand these records to.
    const candidates = [order1, order2, order3, order4, orderDecoy, parcel.orderId];
    const loaderBound: string[] = [];
    await prisma.$transaction(async (tx) => {
      for (const orderId of candidates) {
        const loaded = await loadTrendyolParcel(tx, { organizationId: org, orderId });
        if (loaded.records.length > 0 || loaded.cargoItems.length > 0) {
          loaderBound.push(orderId);
        }
      }
    });
    expect(loaderBound.sort()).toEqual(expected);
  });

  it('binds a settlement return package to its claim order with no payment order (B3)', async () => {
    const parcel = await seedMelontikParcel();
    const order = await createTestOrder({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platformOrderId: '1001',
    });
    await seedClaim({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      orderId: order,
      orderShipmentPackageId: '2002',
    });

    // A return settlement whose shipment package is the claim's return package, not the
    // order's own package, and with no payment order in the batch: only the claim-join
    // branch can bind it to the order.
    const result = await ingestFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platform: Platform.TRENDYOL,
      records: [
        trendyolSettlementRecordInput(
          'Return',
          financialTx({ id: 'ret-1', shipmentPackageId: 2002, debt: 50 }),
        ),
      ],
    });

    expect(result.enqueuedOrders).toBe(1);
    expect(await queuedOrderIds()).toEqual([order]);
  });

  it('binds a late payment order to its settlement order (B5)', async () => {
    const parcel = await seedMelontikParcel();
    const order = await createTestOrder({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platformOrderId: '5001',
    });

    // Store the settlement (carrying its payment order) first, then clear the queue.
    await ingestFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platform: Platform.TRENDYOL,
      records: [
        trendyolSettlementRecordInput(
          'Sale',
          financialTx({
            id: 'sale-5001',
            shipmentPackageId: 5001,
            credit: 100,
            paymentOrderId: 7777,
          }),
        ),
      ],
    });
    await prisma.profitRecomputeRequest.deleteMany({});

    // A later poll brings only the payment order: with no settlement in this batch to
    // match the order directly, it binds through the stored settlement row whose
    // shipment package is the order's own package.
    const result = await ingestFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platform: Platform.TRENDYOL,
      records: [
        trendyolOtherFinancialRecordInput(
          'PaymentOrder',
          financialTx({ id: 'po-5001', paymentOrderId: 7777 }),
        ),
      ],
    });

    expect(result.enqueuedOrders).toBe(1);
    expect(await queuedOrderIds()).toEqual([order]);
  });

  it('binds a late payment order to its settlement claim order (B6)', async () => {
    const parcel = await seedMelontikParcel();
    const order = await createTestOrder({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platformOrderId: '6001',
    });
    await seedClaim({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      orderId: order,
      orderShipmentPackageId: '2006',
    });

    // Store the return settlement (on the claim's return package, carrying its payment
    // order) first, then clear the queue.
    await ingestFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platform: Platform.TRENDYOL,
      records: [
        trendyolSettlementRecordInput(
          'Return',
          financialTx({ id: 'ret-6001', shipmentPackageId: 2006, debt: 50, paymentOrderId: 8888 }),
        ),
      ],
    });
    await prisma.profitRecomputeRequest.deleteMany({});

    // A later poll brings only the payment order: the stored settlement's shipment
    // package is the claim's return package, not the order's own, so it binds through
    // the settlement-to-claim join, not the direct settlement branch.
    const result = await ingestFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platform: Platform.TRENDYOL,
      records: [
        trendyolOtherFinancialRecordInput(
          'PaymentOrder',
          financialTx({ id: 'po-6001', paymentOrderId: 8888 }),
        ),
      ],
    });

    expect(result.enqueuedOrders).toBe(1);
    expect(await queuedOrderIds()).toEqual([order]);
  });

  it('never enqueues another store order that shares the keys', async () => {
    const parcel = await seedMelontikParcel();
    const storeB = await createAdditionalStore({ organizationId: parcel.organizationId });
    const orderA = await createTestOrder({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platformOrderId: '7777',
    });
    const orderB = await createTestOrder({
      organizationId: parcel.organizationId,
      storeId: storeB,
      platformOrderId: '7777',
    });

    const result = await ingestFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platform: Platform.TRENDYOL,
      records: [
        trendyolSettlementRecordInput(
          'Sale',
          financialTx({ id: 'sale-shared', shipmentPackageId: 7777, credit: 100 }),
        ),
      ],
    });

    expect(result.enqueuedOrders).toBe(1);
    expect(await queuedOrderIds()).toEqual([orderA]);
    const siblingRow = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: orderB },
    });
    expect(siblingRow).toBeNull();
  });

  it('stores nothing when the store does not belong to the organization', async () => {
    const parcel = await seedMelontikParcel();
    const carrierId = await upsertMelontikCarrier();
    const otherOrg = await createTrendyolOrg({ carrierId });

    const result = await ingestFinanceRecords(prisma, {
      // The store belongs to parcel's org, not otherOrg: the CROSS JOIN matches no store.
      organizationId: otherOrg.organizationId,
      storeId: parcel.storeId,
      platform: Platform.TRENDYOL,
      records: [
        trendyolSettlementRecordInput(
          'Sale',
          financialTx({ id: 'sale-x', shipmentPackageId: 1001, credit: 100 }),
        ),
      ],
    });

    expect(result.stored).toBe(0);
    expect(result.enqueuedOrders).toBe(0);
    expect(await prisma.marketplaceFinanceRecord.count()).toBe(0);
    expect(await queuedOrderIds()).toEqual([]);
  });
});

describe('pruneUnseenFinanceRecords', () => {
  const WINDOW_START = new Date('2026-10-01T00:00:00.000Z');
  const WINDOW_END = new Date('2026-11-01T00:00:00.000Z');
  const INSIDE = new Date('2026-10-15T00:00:00.000Z');

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  /** All stored record ids of this store, sorted, for survivor assertions. */
  async function storedRecordIds(storeId: string): Promise<string[]> {
    const rows = await prisma.marketplaceFinanceRecord.findMany({
      where: { storeId },
      select: { recordId: true },
    });
    return rows.map((row) => row.recordId).sort();
  }

  it('deletes an unseen record inside the window and enqueues its order', async () => {
    const parcel = await seedMelontikParcel();
    const order = await createTestOrder({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platformOrderId: '1001',
    });
    await insertFinanceRecord({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      family: 'SETTLEMENT',
      transactionType: 'Sale',
      recordId: 'R1',
      shipmentPackageId: '1001',
      transactionDate: INSIDE,
    });

    const result = await pruneUnseenFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      family: FinanceRecordFamily.SETTLEMENT,
      transactionType: 'Sale',
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      seenRecordIds: [],
    });

    expect(result.pruned).toBe(1);
    expect(result.enqueuedOrders).toBe(1);
    expect(await prisma.marketplaceFinanceRecord.count()).toBe(0);
    expect(await queuedOrderIds()).toEqual([order]);
    const queued = await prisma.profitRecomputeRequest.findUniqueOrThrow({
      where: { orderId: order },
    });
    expect(queued.reason).toBe(ProfitRecomputeReason.FINANCE_RECORD);
  });

  it('keeps a record that the scan saw', async () => {
    const parcel = await seedMelontikParcel();
    await createTestOrder({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platformOrderId: '1001',
    });
    await insertFinanceRecord({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      family: 'SETTLEMENT',
      transactionType: 'Sale',
      recordId: 'R1',
      shipmentPackageId: '1001',
      transactionDate: INSIDE,
    });

    const result = await pruneUnseenFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      family: FinanceRecordFamily.SETTLEMENT,
      transactionType: 'Sale',
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      seenRecordIds: ['R1'],
    });

    expect(result.pruned).toBe(0);
    expect(result.enqueuedOrders).toBe(0);
    expect(await storedRecordIds(parcel.storeId)).toEqual(['R1']);
    expect(await queuedOrderIds()).toEqual([]);
  });

  it('keeps records on or outside the window bounds', async () => {
    const parcel = await seedMelontikParcel();
    const base = {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      family: 'SETTLEMENT' as const,
      transactionType: 'Sale',
      shipmentPackageId: null,
    };
    // Exactly the exclusive edges and one day beyond each: none may be pruned.
    await insertFinanceRecord({ ...base, recordId: 'at-start', transactionDate: WINDOW_START });
    await insertFinanceRecord({ ...base, recordId: 'at-end', transactionDate: WINDOW_END });
    await insertFinanceRecord({
      ...base,
      recordId: 'before',
      transactionDate: new Date(WINDOW_START.getTime() - 24 * 60 * 60 * 1000),
    });
    await insertFinanceRecord({
      ...base,
      recordId: 'after',
      transactionDate: new Date(WINDOW_END.getTime() + 24 * 60 * 60 * 1000),
    });

    const result = await pruneUnseenFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      family: FinanceRecordFamily.SETTLEMENT,
      transactionType: 'Sale',
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      seenRecordIds: [],
    });

    expect(result.pruned).toBe(0);
    expect(await storedRecordIds(parcel.storeId)).toEqual([
      'after',
      'at-end',
      'at-start',
      'before',
    ]);
  });

  it('keeps records of another transaction type, family, store or organization', async () => {
    const parcel = await seedMelontikParcel();
    const storeB = await createAdditionalStore({ organizationId: parcel.organizationId });
    const carrierId = await upsertMelontikCarrier();
    const otherOrg = await createTrendyolOrg({ carrierId });

    // The only row that matches the prune's (org, store, family, type) and lies inside
    // the window -- the one row that must be deleted.
    await insertFinanceRecord({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      family: 'SETTLEMENT',
      transactionType: 'Sale',
      recordId: 'match',
      shipmentPackageId: '9999',
      transactionDate: INSIDE,
    });
    // Same store/org/window but a different transaction type.
    await insertFinanceRecord({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      family: 'SETTLEMENT',
      transactionType: 'Return',
      recordId: 'other-type',
      transactionDate: INSIDE,
    });
    // Same store/org/window/type string but a different family.
    await insertFinanceRecord({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      family: 'OTHER_FINANCIAL',
      transactionType: 'Sale',
      recordId: 'other-family',
      transactionDate: INSIDE,
    });
    // Same org and keys but a sibling store.
    await insertFinanceRecord({
      organizationId: parcel.organizationId,
      storeId: storeB,
      family: 'SETTLEMENT',
      transactionType: 'Sale',
      recordId: 'other-store',
      transactionDate: INSIDE,
    });
    // Another organization entirely.
    await insertFinanceRecord({
      organizationId: otherOrg.organizationId,
      storeId: otherOrg.storeId,
      family: 'SETTLEMENT',
      transactionType: 'Sale',
      recordId: 'other-org',
      transactionDate: INSIDE,
    });

    const result = await pruneUnseenFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      family: FinanceRecordFamily.SETTLEMENT,
      transactionType: 'Sale',
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      seenRecordIds: [],
    });

    expect(result.pruned).toBe(1);
    expect(await storedRecordIds(parcel.storeId)).toEqual(['other-family', 'other-type']);
    expect(await storedRecordIds(storeB)).toEqual(['other-store']);
    expect(await storedRecordIds(otherOrg.storeId)).toEqual(['other-org']);
  });

  it('keeps a record with no transaction date', async () => {
    const parcel = await seedMelontikParcel();
    await insertFinanceRecord({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      family: 'SETTLEMENT',
      transactionType: 'Sale',
      recordId: 'dateless',
      transactionDate: null,
    });

    const result = await pruneUnseenFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      family: FinanceRecordFamily.SETTLEMENT,
      transactionType: 'Sale',
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      seenRecordIds: [],
    });

    expect(result.pruned).toBe(0);
    expect(await storedRecordIds(parcel.storeId)).toEqual(['dateless']);
  });

  it('refuses the cargo invoice item family', async () => {
    const parcel = await seedMelontikParcel();
    await insertFinanceRecord({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      family: 'CARGO_INVOICE_ITEM',
      transactionType: TRENDYOL_CARGO_OUTBOUND_ITEM_TYPE,
      recordId: 'INV-1:3003',
      parcelUniqueId: '3003',
      transactionDate: INSIDE,
    });

    await expect(
      pruneUnseenFinanceRecords(prisma, {
        organizationId: parcel.organizationId,
        storeId: parcel.storeId,
        family: FinanceRecordFamily.CARGO_INVOICE_ITEM,
        transactionType: TRENDYOL_CARGO_OUTBOUND_ITEM_TYPE,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        seenRecordIds: [],
      }),
    ).rejects.toThrow(/CARGO_INVOICE_ITEM/);
    // Nothing was deleted.
    expect(await storedRecordIds(parcel.storeId)).toEqual(['INV-1:3003']);
  });
});
