/**
 * Integration tests for loadTrendyolParcel (Phase 3A, Gorev 3). They run against
 * the isolated test database and reproduce the golden melontik parcel, so the
 * loader's output, driven through estimateTrendyolParcel, lands on the same lines
 * the Phase 2A golden test pins.
 *
 * Requires: `supabase start` + `pnpm db:push` before running.
 */

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { prisma } from '@pazarsync/db';
import { ProfitIssueCode, ProfitLineType } from '@pazarsync/db/enums';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { estimateTrendyolParcel } from '../../marketplaces/trendyol/estimate-parcel';
import { TRENDYOL_CARGO_OUTBOUND_ITEM_TYPE } from '../../marketplaces/trendyol/settlement-records';
import { type ProfitLine } from '../../core/profit-line';
import { ParcelNotFoundError, UnsupportedPlatformError } from '../errors';
import { loadTrendyolParcel } from '../load-trendyol-parcel';
import {
  ensureDbReachable,
  MELONTIK,
  seedMelontikParcel,
  truncateAll,
} from './helpers/melontik-parcel';

/** Finds the single line of a type (and its order item), throwing when absent. */
function requireLine(
  lines: readonly ProfitLine[],
  type: ProfitLineType,
  orderItemId: string | null,
): ProfitLine {
  const line = lines.find(
    (candidate) => candidate.type === type && candidate.orderItemId === orderItemId,
  );
  if (line === undefined) {
    throw new Error(`missing ${type} line for order item ${String(orderItemId)}`);
  }
  return line;
}

interface FinanceRecordInput {
  readonly storeId: string;
  readonly organizationId: string;
  readonly family: 'SETTLEMENT' | 'OTHER_FINANCIAL' | 'CARGO_INVOICE_ITEM';
  readonly transactionType: string;
  readonly recordId: string;
  readonly shipmentPackageId?: string | null;
  readonly barcode?: string | null;
  readonly paymentOrderId?: string | null;
  readonly parcelUniqueId?: string | null;
  readonly invoiceSerial?: string | null;
  readonly debt?: string | null;
  readonly credit?: string | null;
  readonly commissionAmount?: string | null;
  readonly amountGross?: string | null;
  readonly desi?: string | null;
  readonly transactionDate?: Date | null;
}

async function insertFinanceRecord(input: FinanceRecordInput): Promise<void> {
  await prisma.marketplaceFinanceRecord.create({
    data: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      platform: 'TRENDYOL',
      family: input.family,
      transactionType: input.transactionType,
      recordId: input.recordId,
      shipmentPackageId: input.shipmentPackageId ?? null,
      barcode: input.barcode ?? null,
      paymentOrderId: input.paymentOrderId ?? null,
      parcelUniqueId: input.parcelUniqueId ?? null,
      invoiceSerial: input.invoiceSerial ?? null,
      debt: input.debt ?? null,
      credit: input.credit ?? null,
      commissionAmount: input.commissionAmount ?? null,
      amountGross: input.amountGross ?? null,
      desi: input.desi ?? null,
      transactionDate: input.transactionDate ?? null,
      payload: {},
      fetchedAt: new Date(),
    },
  });
}

describe('loadTrendyolParcel', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('loads the melontik parcel into the trendyol estimate input', async () => {
    const parcel = await seedMelontikParcel();

    const loaded = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });

    const result = estimateTrendyolParcel(loaded.estimateInput);
    expect(result.issues).toEqual([]);

    const saleA = requireLine(result.lines, ProfitLineType.SALE, parcel.itemA);
    expect(saleA.amount.gross.toFixed(2)).toBe('491.28');
    expect(saleA.amount.vat.toFixed(2)).toBe('44.66');
    const saleB = requireLine(result.lines, ProfitLineType.SALE, parcel.itemB);
    expect(saleB.amount.gross.toFixed(2)).toBe('380.47');
    expect(saleB.amount.vat.toFixed(2)).toBe('34.59');

    const commissionA = requireLine(result.lines, ProfitLineType.COMMISSION, parcel.itemA);
    expect(commissionA.amount.gross.toFixed(2)).toBe('93.34');
    expect(commissionA.amount.vat.toFixed(2)).toBe('15.56');
    const commissionB = requireLine(result.lines, ProfitLineType.COMMISSION, parcel.itemB);
    expect(commissionB.amount.gross.toFixed(2)).toBe('72.29');
    expect(commissionB.amount.vat.toFixed(2)).toBe('12.05');

    const costA = requireLine(result.lines, ProfitLineType.COST_COGS, parcel.itemA);
    expect(costA.amount.gross.toFixed(2)).toBe('233.00');
    expect(costA.amount.vat.toFixed(2)).toBe('21.18');
    const costB = requireLine(result.lines, ProfitLineType.COST_COGS, parcel.itemB);
    expect(costB.amount.gross.toFixed(2)).toBe('165.00');
    expect(costB.amount.vat.toFixed(2)).toBe('15.00');

    const stoppageA = requireLine(result.lines, ProfitLineType.STOPPAGE, parcel.itemA);
    expect(stoppageA.amount.gross.toFixed(2)).toBe('4.47');
    const stoppageB = requireLine(result.lines, ProfitLineType.STOPPAGE, parcel.itemB);
    expect(stoppageB.amount.gross.toFixed(2)).toBe('3.46');

    const serviceFee = requireLine(result.lines, ProfitLineType.SERVICE_FEE, null);
    expect(serviceFee.amount.gross.toFixed(2)).toBe('13.19');
    expect(serviceFee.amount.vat.toFixed(2)).toBe('2.20');

    const shipping = requireLine(result.lines, ProfitLineType.SHIPPING, null);
    expect(shipping.amount.gross.toFixed(2)).toBe('98.34');
    expect(shipping.amount.vat.toFixed(2)).toBe('16.39');
  });

  it('builds the sale as list minus seller discount', async () => {
    // lineSaleGross is set to a value the loader must ignore: the sale is always
    // listGross - sellerDiscountGross.
    const parcel = await seedMelontikParcel({ lineSaleGrossA: '123.45', lineSaleGrossB: '678.90' });

    const loaded = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });

    const byId = new Map(
      loaded.estimateInput.snapshot.items.map((item) => [item.orderItemId, item]),
    );
    const itemA = byId.get(parcel.itemA);
    const itemB = byId.get(parcel.itemB);
    expect(itemA?.saleGross.toFixed(2)).toBe('491.28'); // 529.00 - 37.72
    expect(itemB?.saleGross.toFixed(2)).toBe('380.47'); // 409.68 - 29.21
  });

  it('picks the tariff band period that covers the order date', async () => {
    const parcel = await seedMelontikParcel();

    const tariff = await prisma.commissionTariff.create({
      data: {
        organizationId: parcel.organizationId,
        storeId: parcel.storeId,
        name: 'Melontik tariff',
      },
    });
    const periods: { label: string; startsAt: Date | null; endsAt: Date | null; pct: string }[] = [
      {
        label: 'before',
        startsAt: new Date('2026-09-01T00:00:00Z'),
        endsAt: new Date('2026-09-30T23:59:00Z'),
        pct: '11',
      },
      {
        label: 'covering',
        startsAt: new Date('2026-10-01T00:00:00Z'),
        endsAt: new Date('2026-11-30T23:59:00Z'),
        pct: '17',
      },
      {
        label: 'open',
        startsAt: new Date('2026-10-01T00:00:00Z'),
        endsAt: null,
        pct: '13',
      },
    ];
    for (const [index, period] of periods.entries()) {
      const createdPeriod = await prisma.commissionTariffPeriod.create({
        data: {
          organizationId: parcel.organizationId,
          storeId: parcel.storeId,
          tariffId: tariff.id,
          dateRangeLabel: period.label,
          sortOrder: index,
          startsAt: period.startsAt,
          endsAt: period.endsAt,
        },
      });
      await prisma.commissionTariffItem.create({
        data: {
          organizationId: parcel.organizationId,
          storeId: parcel.storeId,
          periodId: createdPeriod.id,
          barcode: MELONTIK.items.a.barcode,
          productTitle: `Melontik ${period.label}`,
          currentPrice: MELONTIK.items.a.saleGross,
          currentCommissionPct: period.pct,
          bands: [{ key: 'band1', commissionPct: period.pct }],
        },
      });
    }

    const loaded = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });

    const attrA = loaded.estimateInput.attributes.items.find((i) => i.orderItemId === parcel.itemA);
    const attrB = loaded.estimateInput.attributes.items.find((i) => i.orderItemId === parcel.itemB);
    expect(attrA?.tariffBands).not.toBeNull();
    expect(attrA?.tariffBands).toHaveLength(1);
    expect(attrA?.tariffBands?.[0]?.ratePct.toFixed(0)).toBe('17'); // the covering period
    expect(attrB?.tariffBands).toBeNull(); // no tariff for bc-b
  });

  it('counts accepted claim units as accepted returns', async () => {
    const parcel = await seedMelontikParcel();

    const claim = await prisma.orderClaim.create({
      data: {
        organizationId: parcel.organizationId,
        storeId: parcel.storeId,
        orderId: parcel.orderId,
        trendyolClaimId: `claim-${randomUUID().slice(0, 8)}`,
        claimDate: new Date(),
        resolved: false,
      },
    });
    // Two Accepted rows for item A (ordered quantity 1) must cap at 1; a Rejected
    // row for item B must not count at all.
    for (let i = 0; i < 2; i += 1) {
      await prisma.orderClaimItem.create({
        data: {
          claimId: claim.id,
          orderItemId: parcel.itemA,
          trendyolClaimItemId: `acc-${randomUUID()}`,
          reasonCode: 'DAMAGEDITEM',
          reasonName: 'reason',
          status: 'Accepted',
          acceptedBySeller: true,
          resolved: true,
        },
      });
    }
    await prisma.orderClaimItem.create({
      data: {
        claimId: claim.id,
        orderItemId: parcel.itemB,
        trendyolClaimItemId: `rej-${randomUUID()}`,
        reasonCode: 'DAMAGEDITEM',
        reasonName: 'reason',
        status: 'Rejected',
        acceptedBySeller: false,
        resolved: true,
      },
    });

    const loaded = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });

    expect(loaded.estimateInput.acceptedReturns).toEqual([
      { orderItemId: parcel.itemA, acceptedQuantity: 1 },
    ]);
  });

  it('loads the raw sale, discount, payment order and cargo records of the parcel', async () => {
    const tracking = BigInt('7331234567');
    const parcel = await seedMelontikParcel({ cargoTrackingNumber: tracking });
    const base = { storeId: parcel.storeId, organizationId: parcel.organizationId } as const;

    await insertFinanceRecord({
      ...base,
      family: 'SETTLEMENT',
      transactionType: 'Sale',
      recordId: 'sale-a',
      shipmentPackageId: parcel.platformOrderId,
      barcode: MELONTIK.items.a.barcode,
      credit: '529.00',
      commissionAmount: '100.51',
      paymentOrderId: MELONTIK.paymentOrderId,
    });
    await insertFinanceRecord({
      ...base,
      family: 'SETTLEMENT',
      transactionType: 'Discount',
      recordId: 'disc-a',
      shipmentPackageId: parcel.platformOrderId,
      barcode: MELONTIK.items.a.barcode,
      debt: '37.72',
      commissionAmount: '7.17',
    });
    await insertFinanceRecord({
      ...base,
      family: 'SETTLEMENT',
      transactionType: 'Sale',
      recordId: 'sale-b',
      shipmentPackageId: parcel.platformOrderId,
      barcode: MELONTIK.items.b.barcode,
      credit: '409.68',
      commissionAmount: '77.84',
      paymentOrderId: MELONTIK.paymentOrderId,
    });
    await insertFinanceRecord({
      ...base,
      family: 'SETTLEMENT',
      transactionType: 'Discount',
      recordId: 'disc-b',
      shipmentPackageId: parcel.platformOrderId,
      barcode: MELONTIK.items.b.barcode,
      debt: '29.21',
      commissionAmount: '5.55',
    });
    await insertFinanceRecord({
      ...base,
      family: 'OTHER_FINANCIAL',
      transactionType: 'PaymentOrder',
      recordId: 'po-1',
      paymentOrderId: MELONTIK.paymentOrderId,
    });
    await insertFinanceRecord({
      ...base,
      family: 'CARGO_INVOICE_ITEM',
      transactionType: TRENDYOL_CARGO_OUTBOUND_ITEM_TYPE,
      recordId: 'cargo-1',
      parcelUniqueId: tracking.toString(),
      invoiceSerial: 'INV1',
      amountGross: '98.34',
      desi: '2',
    });

    // A record of ANOTHER store with the same shipmentPackageId must not load.
    const otherStore = await prisma.store.create({
      data: {
        organizationId: parcel.organizationId,
        name: 'Other Store',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: randomUUID(),
        status: 'ACTIVE',
        credentials: 'x',
        shippingTariffSource: 'TRENDYOL_CONTRACT',
      },
    });
    await insertFinanceRecord({
      storeId: otherStore.id,
      organizationId: parcel.organizationId,
      family: 'SETTLEMENT',
      transactionType: 'Sale',
      recordId: 'other-store-sale',
      shipmentPackageId: parcel.platformOrderId,
      barcode: MELONTIK.items.a.barcode,
      credit: '529.00',
    });

    const loaded = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });

    expect(loaded.loadIssues).toEqual([]);
    // Deterministic order by (transactionDate, recordId); all dates null here.
    expect(loaded.records.map((r) => r.recordId)).toEqual([
      'disc-a',
      'disc-b',
      'po-1',
      'sale-a',
      'sale-b',
    ]);

    const saleA = loaded.records.find((r) => r.recordId === 'sale-a');
    expect(saleA?.transactionType).toBe('Sale');
    expect(saleA?.credit.toFixed(2)).toBe('529.00');
    expect(saleA?.debt.toFixed(2)).toBe('0.00'); // null side read as zero
    expect(saleA?.commissionAmount?.toFixed(2)).toBe('100.51');
    expect(saleA?.paymentOrderId).toBe(MELONTIK.paymentOrderId);

    const discA = loaded.records.find((r) => r.recordId === 'disc-a');
    expect(discA?.debt.toFixed(2)).toBe('37.72');
    expect(discA?.credit.toFixed(2)).toBe('0.00');

    expect(loaded.cargoItems).toHaveLength(1);
    const cargo = loaded.cargoItems[0];
    expect(cargo?.invoiceSerial).toBe('INV1');
    expect(cargo?.itemType).toBe(TRENDYOL_CARGO_OUTBOUND_ITEM_TYPE);
    expect(cargo?.parcelUniqueId).toBe(tracking.toString());
    expect(cargo?.amountGross.toFixed(2)).toBe('98.34');
    expect(cargo?.desi).toEqual(new Decimal('2'));
  });

  it('turns raw rows it cannot map into non-blocking issues', async () => {
    const tracking = BigInt('7339999999');
    const parcel = await seedMelontikParcel({ cargoTrackingNumber: tracking });
    const base = { storeId: parcel.storeId, organizationId: parcel.organizationId } as const;

    await insertFinanceRecord({
      ...base,
      family: 'SETTLEMENT',
      transactionType: 'NotARealType',
      recordId: 'weird-1',
      shipmentPackageId: parcel.platformOrderId,
    });
    await insertFinanceRecord({
      ...base,
      family: 'CARGO_INVOICE_ITEM',
      transactionType: TRENDYOL_CARGO_OUTBOUND_ITEM_TYPE,
      recordId: 'cargo-bad',
      parcelUniqueId: tracking.toString(),
      invoiceSerial: null, // no serial -> cannot map
      amountGross: '50.00',
    });

    const loaded = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });

    expect(loaded.records).toHaveLength(0);
    expect(loaded.cargoItems).toHaveLength(0);
    expect(loaded.loadIssues).toContainEqual({
      code: ProfitIssueCode.UNMAPPED_MARKETPLACE_RECORD,
      orderItemId: null,
      detail: 'FINANCE_RECORD:SETTLEMENT:NotARealType:weird-1',
    });
    expect(loaded.loadIssues).toContainEqual({
      code: ProfitIssueCode.UNMAPPED_MARKETPLACE_RECORD,
      orderItemId: null,
      detail: `FINANCE_RECORD:CARGO_INVOICE_ITEM:${TRENDYOL_CARGO_OUTBOUND_ITEM_TYPE}:cargo-bad`,
    });
  });

  it('uses the order settings snapshot and falls back to the store settings', async () => {
    // Store says stopaj off, negative VAT off. The order snapshot overrides stopaj
    // to on and leaves negative VAT unset, which must fall back to the store value.
    const parcel = await seedMelontikParcel({
      storeProfitSettings: { includeStopaj: false, includeNegativeNetVat: false },
      snapshotIncludeStopaj: true,
      snapshotIncludeNegativeNetVat: null,
    });

    const loaded = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });

    expect(loaded.settings).toEqual({ includeStopaj: true, includeNegativeNetVat: false });
    expect(loaded.isExcluded).toBe(false);
  });

  it('refuses another organization', async () => {
    const parcel = await seedMelontikParcel();

    await expect(
      loadTrendyolParcel(prisma, { organizationId: randomUUID(), orderId: parcel.orderId }),
    ).rejects.toBeInstanceOf(ParcelNotFoundError);
  });

  it('refuses a non-trendyol store', async () => {
    const org = await prisma.organization.create({
      data: { name: 'HB Org', slug: `hb-${randomUUID().slice(0, 8)}`, currency: 'TRY' },
    });
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'HB Store',
        platform: 'HEPSIBURADA',
        environment: 'PRODUCTION',
        externalAccountId: randomUUID(),
        status: 'ACTIVE',
        credentials: 'x',
        shippingTariffSource: 'TRENDYOL_CONTRACT',
      },
    });
    const order = await prisma.order.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformOrderId: `hb-${randomUUID().slice(0, 8)}`,
        orderDate: new Date(),
        status: 'DELIVERED',
      },
    });

    await expect(
      loadTrendyolParcel(prisma, { organizationId: org.id, orderId: order.id }),
    ).rejects.toBeInstanceOf(UnsupportedPlatformError);
  });
});
