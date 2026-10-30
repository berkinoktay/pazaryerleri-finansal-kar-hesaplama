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
import { FinanceRecordFamily, Platform } from '@pazarsync/db/enums';
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
import { ingestFinanceRecords } from '../finance-records';
import { loadTrendyolParcel } from '../load-trendyol-parcel';
import {
  createAdditionalStore,
  createTrendyolOrg,
  ensureDbReachable,
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
