// handleCargoInvoiceItems — invoice line → OrderFee SHIPPING / RETURN_SHIPPING
// (PR-8). Matching, VAT-from-FeeDefinition, idempotency, and the cron
// composition path (getCargoInvoiceSerial branch + fetcher DI) against a
// real DB. Wire numbers mirror the prod capture in research 2026-06-09.

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import { FinanceRecordFamily, ProfitRecomputeReason } from '@pazarsync/db/enums';
import type { CargoInvoiceItem, TrendyolFinancialTransaction } from '@pazarsync/marketplace';
import { encryptCredentials } from '@pazarsync/sync-core';

import { handleCargoInvoiceItems } from '../../src/handlers/settlements/cargo-invoice-fees';
import { processSettlementsChunk } from '../../src/handlers/settlements';
import {
  createMembership,
  createOrganization,
  createUserProfile,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';
import { ensureFeeDefinitions } from '../../../../apps/api/tests/helpers/seed-fee-definitions';

const SERIAL = 'DDF2026013132324';
const TRACKING = 7330032270766345n;

interface Ctx {
  organizationId: string;
  storeId: string;
}

async function buildStore(): Promise<Ctx> {
  const user = await createUserProfile();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Cargo Test Store',
      platform: 'TRENDYOL',
      environment: 'SANDBOX',
      externalAccountId: '123456',
      credentials: encryptCredentials({ supplierId: '123456', apiKey: 'k', apiSecret: 's' }),
      status: 'ACTIVE',
    },
  });
  return { organizationId: org.id, storeId: store.id };
}

async function createCargoOrder(
  ctx: Ctx,
  over: {
    platformOrderId: string;
    platformOrderNumber?: string;
    cargoTrackingNumber?: bigint | null;
    usesSellerCargoAgreement?: boolean;
  },
): Promise<string> {
  const order = await prisma.order.create({
    data: {
      organizationId: ctx.organizationId,
      storeId: ctx.storeId,
      platformOrderId: over.platformOrderId,
      platformOrderNumber: over.platformOrderNumber ?? null,
      orderDate: new Date(),
      status: 'DELIVERED',
      saleGross: new Decimal('120.00'), // GROSS CONVENTION (saleSubtotalNet kaldırıldı)
      reconciliationStatus: 'NOT_SETTLED',
      cargoTrackingNumber: over.cargoTrackingNumber ?? null,
      usesSellerCargoAgreement: over.usesSellerCargoAgreement ?? false,
    },
  });
  return order.id;
}

function makeCargoRow(): TrendyolFinancialTransaction {
  return {
    id: SERIAL,
    transactionDate: 1780867982915,
    barcode: null,
    transactionType: 'Kargo Fatura',
    receiptId: null,
    description: 'Kargo taşıma işlemini kargo firmaları yaptığından KDV tevkifat uygulanmamıştır.',
    debt: 8998.4,
    credit: 0,
    paymentPeriod: null,
    commissionRate: null,
    commissionAmount: null,
    commissionInvoiceSerialNumber: SERIAL,
    sellerRevenue: null,
    orderNumber: null,
    paymentOrderId: 58450612,
    paymentDate: 1780781582915,
    sellerId: 123456,
    storeId: null,
    storeName: null,
    storeAddress: null,
    country: 'Türkiye',
    orderDate: null,
    affiliate: 'TRENDYOLTR',
    shipmentPackageId: null,
  };
}

function item(over: Partial<CargoInvoiceItem> = {}): CargoInvoiceItem {
  return {
    shipmentPackageType: 'Gönderi Kargo Bedeli',
    parcelUniqueId: Number(TRACKING),
    orderNumber: '11180007214',
    amount: 93.05,
    desi: 1,
    ...over,
  };
}

async function runInTx(
  ctx: Ctx,
  items: CargoInvoiceItem[],
): Promise<Awaited<ReturnType<typeof handleCargoInvoiceItems>>> {
  return prisma.$transaction(async (tx) =>
    handleCargoInvoiceItems(ctx.storeId, ctx.organizationId, makeCargoRow(), items, tx),
  );
}

describe('handleCargoInvoiceItems (PR-8)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    await ensureFeeDefinitions();
  });

  it('writes a SHIPPING fee via tracking match; VAT split from FeeDefinition', async () => {
    const ctx = await buildStore();
    const orderId = await createCargoOrder(ctx, {
      platformOrderId: '3800664731',
      platformOrderNumber: '11180007214',
      cargoTrackingNumber: TRACKING,
    });

    const result = await runInTx(ctx, [item()]);

    expect(result.writtenFees).toBe(1);
    const fee = await prisma.orderFee.findFirstOrThrow({ where: { orderId } });
    expect(fee.feeType).toBe('SHIPPING');
    expect(fee.source).toBe('CARGO_INVOICE');
    expect(fee.direction).toBe('DEBIT');
    // GROSS CONVENTION: item.amount=93.05 KDV-dahil → amountGross=93.05; vatRate=20 (DB-driven).
    // Net türetilir downstream (93.05 × 100/120 = 77.54). Net-split kaldırıldı.
    expect(new Decimal(fee.amountGross.toString()).toString()).toBe('93.05');
    expect(new Decimal(fee.vatRate.toString()).toString()).toBe('20');
    expect(fee.feeDefinitionId).not.toBeNull();
    // #297: identity columns stamped — without them the partial unique
    // guard would never apply and dedupe would silently break.
    expect(fee.invoiceSerialNumber).toBe(SERIAL);
    expect(fee.parcelUniqueId).toBe(TRACKING.toString());
    expect(fee.externalRef).toEqual({
      invoiceSerialNumber: SERIAL,
      parcelUniqueId: TRACKING.toString(),
      desi: 1,
    });
  });

  it("maps 'İade Kargo Bedeli' to RETURN_SHIPPING", async () => {
    const ctx = await buildStore();
    const orderId = await createCargoOrder(ctx, {
      platformOrderId: 'pkg-return',
      cargoTrackingNumber: TRACKING,
    });

    const result = await runInTx(ctx, [item({ shipmentPackageType: 'İade Kargo Bedeli' })]);

    expect(result.writtenFees).toBe(1);
    const fee = await prisma.orderFee.findFirstOrThrow({ where: { orderId } });
    expect(fee.feeType).toBe('RETURN_SHIPPING');
  });

  it('falls back to a SINGLE platformOrderNumber match when tracking is absent', async () => {
    const ctx = await buildStore();
    const orderId = await createCargoOrder(ctx, {
      platformOrderId: 'pkg-legacy',
      platformOrderNumber: '11180007214',
      cargoTrackingNumber: null,
    });

    const result = await runInTx(ctx, [item()]);

    expect(result.writtenFees).toBe(1);
    expect(await prisma.orderFee.count({ where: { orderId } })).toBe(1);
  });

  it('skips on ambiguous orderNumber match (split order, no tracking)', async () => {
    const ctx = await buildStore();
    await createCargoOrder(ctx, {
      platformOrderId: 'pkg-a',
      platformOrderNumber: '11180007214',
      cargoTrackingNumber: null,
    });
    await createCargoOrder(ctx, {
      platformOrderId: 'pkg-b',
      platformOrderNumber: '11180007214',
      cargoTrackingNumber: null,
    });

    const result = await runInTx(ctx, [item()]);

    expect(result.writtenFees).toBe(0);
    expect(result.ambiguousItems).toBe(1);
    expect(await prisma.orderFee.count()).toBe(0);
  });

  it('skips with no match (order not synced yet) — retried on a later scan', async () => {
    const ctx = await buildStore();

    const result = await runInTx(ctx, [item()]);

    expect(result.writtenFees).toBe(0);
    expect(result.unmatchedItems).toBe(1);
  });

  it('re-running the same invoice writes nothing new (idempotent)', async () => {
    const ctx = await buildStore();
    const orderId = await createCargoOrder(ctx, {
      platformOrderId: 'pkg-idem',
      cargoTrackingNumber: TRACKING,
    });

    const first = await runInTx(ctx, [item()]);
    const second = await runInTx(ctx, [item()]);

    expect(first.writtenFees).toBe(1);
    expect(second.writtenFees).toBe(0);
    expect(second.dedupedItems).toBe(1);
    expect(await prisma.orderFee.count({ where: { orderId } })).toBe(1);
  });

  it('a reclassified line (same serial+parcel, flipped type) dedupes instead of tripping the DB guard (#297)', async () => {
    // The pre-check deliberately omits feeType to mirror the partial unique
    // (order_id, invoice_serial_number, parcel_unique_id). Restoring feeType
    // to the pre-check would let this re-scan slip past it and 23505-abort
    // the invoice transaction — this test pins the dedupe at the handler layer.
    const ctx = await buildStore();
    const orderId = await createCargoOrder(ctx, {
      platformOrderId: 'pkg-reclass',
      cargoTrackingNumber: TRACKING,
    });

    const first = await runInTx(ctx, [item()]);
    const second = await runInTx(ctx, [item({ shipmentPackageType: 'İade Kargo Bedeli' })]);

    expect(first.writtenFees).toBe(1);
    expect(second.writtenFees).toBe(0);
    expect(second.dedupedItems).toBe(1);
    const fees = await prisma.orderFee.findMany({ where: { orderId } });
    expect(fees).toHaveLength(1);
    expect(fees[0]?.feeType).toBe('SHIPPING');
  });

  it('unknown shipmentPackageType is counted and skipped', async () => {
    const ctx = await buildStore();
    await createCargoOrder(ctx, { platformOrderId: 'pkg-x', cargoTrackingNumber: TRACKING });

    const result = await runInTx(ctx, [item({ shipmentPackageType: 'Yepyeni Bedel Türü' })]);

    expect(result.writtenFees).toBe(0);
    expect(result.unknownTypeItems).toBe(1);
  });

  // Phase 3B: the cron no longer calls handleCargoInvoiceItems. It still pre-fetches the
  // invoice's items by serial, but now stores the invoice row and every item raw in
  // marketplace_finance_records and enqueues the bound order — no legacy OrderFee, no
  // reconciliation bump. (The direct handleCargoInvoiceItems tests above stay as-is: the
  // handler file is untouched until phase 5.)
  it('cron path: Kargo Fatura row pre-fetches items and stores them raw (composition)', async () => {
    const ctx = await buildStore();
    const orderId = await createCargoOrder(ctx, {
      platformOrderId: 'pkg-cron',
      cargoTrackingNumber: TRACKING,
    });
    const log = await prisma.syncLog.create({
      data: {
        organizationId: ctx.organizationId,
        storeId: ctx.storeId,
        syncType: 'SETTLEMENTS',
        status: 'RUNNING',
        startedAt: new Date(),
        claimedAt: new Date(),
        claimedBy: 'worker-test',
        lastTickAt: new Date(),
        progressCurrent: 0,
      },
    });

    await processSettlementsChunk(
      { syncLog: log, cursor: null, workerId: 'worker-test' },
      {
        fetchSettlements: async function* () {
          // no settlement rows in this scenario
          yield* [];
          return { totalElements: 0, yielded: 0 };
        },
        fetchOtherFinancials: async function* (opts) {
          let yielded = 0;
          if (opts.transactionType === 'DeductionInvoices') {
            yield makeCargoRow();
            yielded = 1;
          }
          return { totalElements: yielded, yielded };
        },
        fetchCargoInvoiceItems: async (opts) => {
          expect(opts.invoiceSerialNumber).toBe(SERIAL);
          return [item()];
        },
      },
    );

    // The invoice row itself plus its one item are stored raw; no legacy OrderFee.
    const invoiceRow = await prisma.marketplaceFinanceRecord.findFirstOrThrow({
      where: { storeId: ctx.storeId, family: FinanceRecordFamily.OTHER_FINANCIAL },
    });
    expect(invoiceRow.transactionType).toBe('DeductionInvoices');
    const cargoRows = await prisma.marketplaceFinanceRecord.findMany({
      where: { storeId: ctx.storeId, family: FinanceRecordFamily.CARGO_INVOICE_ITEM },
    });
    expect(cargoRows).toHaveLength(1);
    expect(cargoRows[0]?.recordId).toBe(`${SERIAL}:${TRACKING.toString()}`);
    expect(await prisma.orderFee.count({ where: { orderId } })).toBe(0);

    // The order the cargo item binds to (by tracking number) is enqueued for a recompute.
    const queued = await prisma.profitRecomputeRequest.findUniqueOrThrow({ where: { orderId } });
    expect(queued.reason).toBe(ProfitRecomputeReason.FINANCE_RECORD);
  });
});
