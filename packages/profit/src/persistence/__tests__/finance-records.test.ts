/**
 * Integration tests for the two-phase raw finance-record outbox (Phase 3B, Gorev 6).
 * They run against the isolated test database. Phase 1 (`ingestFinanceRecords`) only
 * stores rows and flags inserted or changed ones `bind_pending`; Phase 2
 * (`bindPendingFinanceRecords`) resolves the flagged rows to their orders and enqueues a
 * profit recompute after the store transaction has committed. They pin that rows are
 * stored idempotently on the (store, family, record_id) key, that an unchanged re-ingest
 * stores nothing and enqueues nothing, that a changed row is flagged and bound, that a
 * sale row is updated in place when its payment order arrives later, that a cargo item
 * keeps one row when a re-scan relabels it, that a row stored before its order exists is
 * bound by the first pass to run after the order is committed, that the bound order set
 * equals exactly what the loader would bind, that a sibling store's order sharing the
 * keys is never enqueued, and that a store/organization mismatch stores and binds nothing.
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
import {
  bindPendingFinanceRecords,
  ingestFinanceRecords,
  pruneUnseenFinanceRecords,
} from '../finance-records';
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

/** Creates one order with a platform order number and a single item on a given barcode. */
async function createOrderWithItem(params: {
  readonly organizationId: string;
  readonly storeId: string;
  readonly platformOrderNumber: string;
  readonly barcode: string;
}): Promise<string> {
  const order = await prisma.order.create({
    data: {
      organizationId: params.organizationId,
      storeId: params.storeId,
      platformOrderId: `po-${randomUUID().slice(0, 8)}`,
      platformOrderNumber: params.platformOrderNumber,
      orderDate: MELONTIK.orderDate,
      status: 'DELIVERED',
    },
  });
  await prisma.orderItem.create({
    data: {
      orderId: order.id,
      organizationId: params.organizationId,
      quantity: 1,
      barcode: params.barcode,
      lineListGross: '100.00',
      lineSaleGross: '100.00',
      lineSellerDiscountGross: '0',
      saleVatRate: '10',
      commissionRate: '19',
      commissionGross: '0',
      commissionVatRate: '20',
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
    // The second ingest sees four unchanged rows: the conditional ON CONFLICT touches
    // none of them, so nothing is stored and no row is duplicated.
    expect(second.stored).toBe(0);
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
    const firstBind = await bindPendingFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
    });
    expect(firstBind.enqueuedOrders).toBe(1);
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
    // The sale row gained a payment order and the PaymentOrder row is new: both change.
    expect(second.stored).toBe(2);
    const secondBind = await bindPendingFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
    });
    expect(secondBind.enqueuedOrders).toBe(1);

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

  it('stores a row whose order does not exist yet and binds nothing', async () => {
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
    // The bind pass clears the flagged row but finds no order to enqueue (it does not
    // exist yet). The flag is NOT kept set -- this record is never re-picked here. When
    // the order is created later, upsertOrderWithSnapshot's create-time ORDER_CHANGED
    // recompute reads this already-stored record; that path covers the late order, not a
    // second bind pass.
    const bind = await bindPendingFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
    });
    expect(bind.bound).toBe(1);
    expect(bind.enqueuedOrders).toBe(0);
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
    const bind = await bindPendingFinanceRecords(prisma, { organizationId: org, storeId: store });
    expect(bind.enqueuedOrders).toBe(4);

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
    await ingestFinanceRecords(prisma, {
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

    const bind = await bindPendingFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
    });
    expect(bind.enqueuedOrders).toBe(1);
    expect(await queuedOrderIds()).toEqual([order]);
  });

  it('binds a late payment order to its settlement order (B5)', async () => {
    const parcel = await seedMelontikParcel();
    const order = await createTestOrder({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platformOrderId: '5001',
    });

    // Store the settlement (carrying its payment order) first, bind it, then clear the
    // queue so the second bind pass has only the payment order left to resolve.
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
    await bindPendingFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
    });
    await prisma.profitRecomputeRequest.deleteMany({});

    // A later poll brings only the payment order: with no settlement flagged in this pass
    // to match the order directly, it binds through the stored settlement row whose
    // shipment package is the order's own package.
    await ingestFinanceRecords(prisma, {
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

    const bind = await bindPendingFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
    });
    expect(bind.enqueuedOrders).toBe(1);
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
    // order) first, bind it, then clear the queue.
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
    await bindPendingFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
    });
    await prisma.profitRecomputeRequest.deleteMany({});

    // A later poll brings only the payment order: the stored settlement's shipment
    // package is the claim's return package, not the order's own, so it binds through
    // the settlement-to-claim join, not the direct settlement branch.
    await ingestFinanceRecords(prisma, {
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

    const bind = await bindPendingFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
    });
    expect(bind.enqueuedOrders).toBe(1);
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

    await ingestFinanceRecords(prisma, {
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

    const bind = await bindPendingFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
    });
    expect(bind.enqueuedOrders).toBe(1);
    expect(await queuedOrderIds()).toEqual([orderA]);
    const siblingRow = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: orderB },
    });
    expect(siblingRow).toBeNull();
  });

  it('enqueues the parcel a package-less record names by order number and barcode', async () => {
    const parcel = await seedMelontikParcel();
    const orderNumber = 'ORDER-4B-ENQUEUE';
    // The parcel order carries this platform order number, and item A carries the barcode
    // the package-less record names.
    await prisma.order.update({
      where: { id: parcel.orderId },
      data: { platformOrderNumber: orderNumber },
    });

    // A Return with no shipment package id and no payment order: only the order-number +
    // barcode branch can resolve it to the parcel.
    const result = await ingestFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platform: Platform.TRENDYOL,
      records: [
        trendyolSettlementRecordInput(
          'Return',
          financialTx({
            id: 'ret-pkgless',
            shipmentPackageId: null,
            orderNumber,
            barcode: MELONTIK.items.a.barcode,
            debt: 50,
          }),
        ),
      ],
    });

    expect(result.stored).toBe(1);
    const bind = await bindPendingFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
    });
    expect(bind.enqueuedOrders).toBe(1);
    expect(await queuedOrderIds()).toEqual([parcel.orderId]);
  });

  it("pairs each package-less record's order number with its own barcode", async () => {
    const parcel = await seedMelontikParcel();
    const org = parcel.organizationId;
    const store = parcel.storeId;

    // Two package-less records: order number A names barcode X, order number B names
    // barcode Y. Three orders: A/X and B/Y each match a record; A/Y shares A's order
    // number and Y's barcode but no record names that pair. A cartesian resolve
    // (= ANY(numbers) AND = ANY(barcodes)) would wrongly enqueue A/Y; the per-pair unnest
    // join must enqueue only A/X and B/Y.
    const orderAX = await createOrderWithItem({
      organizationId: org,
      storeId: store,
      platformOrderNumber: 'PAIR-A',
      barcode: 'bc-x',
    });
    const orderBY = await createOrderWithItem({
      organizationId: org,
      storeId: store,
      platformOrderNumber: 'PAIR-B',
      barcode: 'bc-y',
    });
    await createOrderWithItem({
      organizationId: org,
      storeId: store,
      platformOrderNumber: 'PAIR-A',
      barcode: 'bc-y',
    });

    const result = await ingestFinanceRecords(prisma, {
      organizationId: org,
      storeId: store,
      platform: Platform.TRENDYOL,
      records: [
        trendyolSettlementRecordInput(
          'Return',
          financialTx({
            id: 'ret-ax',
            shipmentPackageId: null,
            orderNumber: 'PAIR-A',
            barcode: 'bc-x',
            debt: 10,
          }),
        ),
        trendyolSettlementRecordInput(
          'Return',
          financialTx({
            id: 'ret-by',
            shipmentPackageId: null,
            orderNumber: 'PAIR-B',
            barcode: 'bc-y',
            debt: 20,
          }),
        ),
      ],
    });

    expect(result.stored).toBe(2);
    const bind = await bindPendingFinanceRecords(prisma, { organizationId: org, storeId: store });
    expect(bind.enqueuedOrders).toBe(2);
    expect(await queuedOrderIds()).toEqual([orderAX, orderBY].sort());
  });

  it("tenant: a store that is not the organization's stores nothing and binds nothing", async () => {
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
    // The bind pass is filtered by both organization and store, so the wrong organization
    // picks up none of this store's rows and binds nothing.
    const bind = await bindPendingFinanceRecords(prisma, {
      organizationId: otherOrg.organizationId,
      storeId: parcel.storeId,
    });
    expect(bind.bound).toBe(0);
    expect(bind.enqueuedOrders).toBe(0);
    expect(await prisma.marketplaceFinanceRecord.count()).toBe(0);
    expect(await queuedOrderIds()).toEqual([]);
  });

  it('an identical re-ingest stores nothing and leaves nothing pending', async () => {
    const parcel = await seedMelontikParcel();
    const order = await createTestOrder({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platformOrderId: '1001',
    });
    const records: FinanceRecordInput[] = [
      trendyolSettlementRecordInput(
        'Sale',
        financialTx({ id: 'sale-a', shipmentPackageId: 1001, credit: 529 }),
      ),
    ];

    const first = await ingestFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platform: Platform.TRENDYOL,
      records,
    });
    expect(first.stored).toBe(1);
    const firstBind = await bindPendingFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
    });
    expect(firstBind.bound).toBe(1);
    expect(firstBind.enqueuedOrders).toBe(1);
    expect(await queuedOrderIds()).toEqual([order]);

    // Capture the row AFTER the first bind cleared its flag, then drain the queue.
    const before = await prisma.marketplaceFinanceRecord.findFirstOrThrow({
      where: { recordId: 'sale-a' },
    });
    await prisma.profitRecomputeRequest.deleteMany({});

    const second = await ingestFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platform: Platform.TRENDYOL,
      records,
    });
    expect(second.stored).toBe(0);
    const secondBind = await bindPendingFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
    });
    expect(secondBind.bound).toBe(0);
    expect(secondBind.enqueuedOrders).toBe(0);
    expect(await queuedOrderIds()).toEqual([]);

    // The unchanged re-ingest never touched the row: its updated_at is exactly the bind's.
    const after = await prisma.marketplaceFinanceRecord.findFirstOrThrow({
      where: { recordId: 'sale-a' },
    });
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it('a changed record is flagged and its order enqueued by the bind pass', async () => {
    const parcel = await seedMelontikParcel();
    const order = await createTestOrder({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platformOrderId: '1001',
    });

    await ingestFinanceRecords(prisma, {
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
    await bindPendingFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
    });
    await prisma.profitRecomputeRequest.deleteMany({});

    // Re-ingest the same record with a different credit: the change flags the row.
    const changed = await ingestFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platform: Platform.TRENDYOL,
      records: [
        trendyolSettlementRecordInput(
          'Sale',
          financialTx({ id: 'sale-a', shipmentPackageId: 1001, credit: 600 }),
        ),
      ],
    });
    expect(changed.stored).toBe(1);
    const flagged = await prisma.marketplaceFinanceRecord.findFirstOrThrow({
      where: { recordId: 'sale-a' },
    });
    expect(flagged.bindPending).toBe(true);

    const bind = await bindPendingFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
    });
    expect(bind.bound).toBe(1);
    expect(bind.enqueuedOrders).toBe(1);
    expect(await queuedOrderIds()).toEqual([order]);
    const cleared = await prisma.marketplaceFinanceRecord.findFirstOrThrow({
      where: { recordId: 'sale-a' },
    });
    expect(cleared.bindPending).toBe(false);
  });

  it('a record stored before its order exists is bound once the order exists', async () => {
    const parcel = await seedMelontikParcel();

    // The settlement arrives before its order: it is stored and left flagged.
    const result = await ingestFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platform: Platform.TRENDYOL,
      records: [
        trendyolSettlementRecordInput(
          'Sale',
          financialTx({ id: 'sale-race', shipmentPackageId: 5555, credit: 100 }),
        ),
      ],
    });
    expect(result.stored).toBe(1);

    // The order is then persisted.
    const order = await createTestOrder({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platformOrderId: '5555',
    });

    // The bind pass resolves a row whose order was committed before the pass ran. The row
    // was still flagged (no pass had run since the ingest), so this first pass enqueues it.
    const bind = await bindPendingFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
    });
    expect(bind.bound).toBe(1);
    expect(bind.enqueuedOrders).toBe(1);
    expect(await queuedOrderIds()).toEqual([order]);
  });

  it('a crashed bind is completed by the next pass', async () => {
    const parcel = await seedMelontikParcel();
    const order = await createTestOrder({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platformOrderId: '1001',
    });

    // Ingest stores the row and flags it; a crash skips the bind pass entirely.
    await ingestFinanceRecords(prisma, {
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
    expect(await queuedOrderIds()).toEqual([]);

    // A later run's bind pass completes the still-flagged row.
    const bind = await bindPendingFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
    });
    expect(bind.bound).toBe(1);
    expect(bind.enqueuedOrders).toBe(1);
    expect(await queuedOrderIds()).toEqual([order]);
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

  it('enqueues the order of a pruned package-less record', async () => {
    const parcel = await seedMelontikParcel();
    const orderNumber = 'ORDER-4B-PRUNE';
    const barcode = 'bc-prune';
    const order = await createOrderWithItem({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platformOrderNumber: orderNumber,
      barcode,
    });
    // A package-less Return (bound only by order number + barcode), in-window, that the
    // scan did not return: pruning deletes it and enqueues the order it bound to through
    // the RETURNING order_number + barcode branch.
    await insertFinanceRecord({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      family: 'SETTLEMENT',
      transactionType: 'Return',
      recordId: 'ret-prune',
      shipmentPackageId: null,
      orderNumber,
      barcode,
      transactionDate: INSIDE,
    });

    const result = await pruneUnseenFinanceRecords(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      family: FinanceRecordFamily.SETTLEMENT,
      transactionType: 'Return',
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

  it('deletes nothing when the organization does not own the store', async () => {
    // Tenant defense: the DELETE is both store- AND organization-scoped. Pruning with
    // another organization but this store's id must spare the store's rows even though
    // their store id matches, mirroring the ingest store/organization-mismatch guard. A
    // store-only filter would wrongly delete the row.
    const parcel = await seedMelontikParcel();
    const carrierId = await upsertMelontikCarrier();
    const otherOrg = await createTrendyolOrg({ carrierId });

    await insertFinanceRecord({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      family: 'SETTLEMENT',
      transactionType: 'Sale',
      recordId: 'A-OWNED',
      shipmentPackageId: '1001',
      transactionDate: INSIDE,
    });

    const result = await pruneUnseenFinanceRecords(prisma, {
      // Org B does not own store A: the organization filter must spare store A's row.
      organizationId: otherOrg.organizationId,
      storeId: parcel.storeId,
      family: FinanceRecordFamily.SETTLEMENT,
      transactionType: 'Sale',
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      seenRecordIds: [],
    });

    expect(result.pruned).toBe(0);
    expect(result.enqueuedOrders).toBe(0);
    expect(await storedRecordIds(parcel.storeId)).toEqual(['A-OWNED']);
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
