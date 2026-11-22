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
import {
  BaremTier,
  Platform,
  ProfitIssueCode,
  ProfitLineCertainty,
  ProfitLineType,
  ProfitStatus,
  ReconciliationStatus,
} from '@pazarsync/db/enums';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { estimateTrendyolParcel } from '../../marketplaces/trendyol/estimate-parcel';
import { CARRIER_NOT_RECOGNIZED_REASON } from '../../marketplaces/trendyol/estimate-shipping';
import { mapTrendyolRecords } from '../../marketplaces/trendyol/map-records';
import {
  TRENDYOL_CARGO_OUTBOUND_ITEM_TYPE,
  TRENDYOL_CARGO_RETURN_ITEM_TYPE,
} from '../../marketplaces/trendyol/settlement-records';
import {
  TRENDYOL_SAME_DAY_SHIPPING_TYPE,
  type TrendyolShippingTariff,
} from '../../marketplaces/trendyol/trendyol-inputs';
import { type ProfitLine } from '../../core/profit-line';
import { computeParcelProfit } from '../compute-parcel-profit';
import { ParcelNotFoundError, UnsupportedPlatformError } from '../errors';
import { loadTrendyolParcel } from '../load-trendyol-parcel';
import {
  createAdditionalStore,
  ensureDbReachable,
  MELONTIK,
  melontikCargoInvoiceInput,
  type MelontikParcel,
  melontikSaleCycleRecordInputs,
  seedMelontikParcel,
  truncateAll,
  upsertCarrierWithTariffs,
  upsertCarrierWithTariffVersions,
} from './helpers/melontik-parcel';

/** Seeds one commission tariff whose single period covers the melontik order date, with
 *  a single band at `pct` on item A's barcode -- used to prove an order IGNORES bands. */
async function seedCoveringTariffBand(parcel: MelontikParcel, pct: string): Promise<void> {
  const tariff = await prisma.commissionTariff.create({
    data: {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      name: 'Covering tariff',
    },
  });
  const period = await prisma.commissionTariffPeriod.create({
    data: {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      tariffId: tariff.id,
      dateRangeLabel: 'covering',
      sortOrder: 0,
      startsAt: new Date('2026-10-01T00:00:00Z'),
      endsAt: new Date('2026-11-30T23:59:00Z'),
    },
  });
  await prisma.commissionTariffItem.create({
    data: {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      periodId: period.id,
      barcode: MELONTIK.items.a.barcode,
      productTitle: 'Covering melontik',
      currentPrice: MELONTIK.items.a.saleGross,
      currentCommissionPct: pct,
      bands: [{ key: 'band1', commissionPct: pct }],
    },
  });
}

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
  readonly orderNumber?: string | null;
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
      orderNumber: input.orderNumber ?? null,
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

  it('falls past the ORDER source when the raw order commission rate is null', async () => {
    const parcel = await seedMelontikParcel();
    // The order line carried no rate of its own: orderCommissionRatePct stays null,
    // so the commission chain never resolves to the ORDER source.
    await prisma.orderItem.updateMany({
      where: { orderId: parcel.orderId },
      data: { orderCommissionRatePct: null },
    });
    // Give both variants a synced product rate so the chain still has a non-ORDER
    // source to fall to (resolveTrendyolCommissionRate: PRODUCT_SYNC).
    await prisma.productVariant.updateMany({
      where: { id: { in: [parcel.variantA, parcel.variantB] } },
      data: { syncedCommissionRate: '15.00' },
    });

    const loaded = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });

    const attrA = loaded.estimateInput.attributes.items.find((i) => i.orderItemId === parcel.itemA);
    const attrB = loaded.estimateInput.attributes.items.find((i) => i.orderItemId === parcel.itemB);
    expect(attrA?.orderCommissionRatePct).toBeNull();
    expect(attrB?.orderCommissionRatePct).toBeNull();

    const result = estimateTrendyolParcel(loaded.estimateInput);
    const commissionA = result.lines.find(
      (line) => line.type === ProfitLineType.COMMISSION && line.orderItemId === parcel.itemA,
    );
    expect(commissionA).toBeDefined();
    expect(commissionA?.inputs.rateSource).not.toBe('ORDER');
    expect(commissionA?.inputs.rateSource).toBe('PRODUCT_SYNC');
  });

  it('reads a positive raw order commission rate as the ORDER rate', async () => {
    const parcel = await seedMelontikParcel();
    // The raw column carries the order line's own rate; the loader reads it verbatim.
    await prisma.orderItem.updateMany({
      where: { orderId: parcel.orderId },
      data: { orderCommissionRatePct: '19.50' },
    });

    const loaded = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });

    const attrA = loaded.estimateInput.attributes.items.find((i) => i.orderItemId === parcel.itemA);
    expect(attrA?.orderCommissionRatePct?.toFixed(2)).toBe('19.50');

    const result = estimateTrendyolParcel(loaded.estimateInput);
    const commissionA = result.lines.find(
      (line) => line.type === ProfitLineType.COMMISSION && line.orderItemId === parcel.itemA,
    );
    expect(commissionA?.inputs.rateSource).toBe('ORDER');
    expect(commissionA?.inputs.ratePct).toBe('19.5');
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

  it('ignores a stored tariff covering the order date and resolves the synced product rate', async () => {
    // Owner decision (2026-11-09): an order never uses a product tariff band. With the
    // order line's own rate cleared and a synced product rate present, a tariff band
    // covering the order date must be IGNORED -- the chain resolves PRODUCT_SYNC.
    const parcel = await seedMelontikParcel();
    await prisma.orderItem.updateMany({
      where: { orderId: parcel.orderId },
      data: { orderCommissionRatePct: null },
    });
    await prisma.productVariant.updateMany({
      where: { id: { in: [parcel.variantA, parcel.variantB] } },
      data: { syncedCommissionRate: '15.00' },
    });
    await seedCoveringTariffBand(parcel, '7');

    const loaded = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });

    const result = estimateTrendyolParcel(loaded.estimateInput);
    const commissionA = result.lines.find(
      (line) => line.type === ProfitLineType.COMMISSION && line.orderItemId === parcel.itemA,
    );
    // The band (7%) is never consulted; the synced product rate (15%) wins.
    expect(commissionA?.inputs.rateSource).toBe('PRODUCT_SYNC');
    expect(commissionA?.inputs.ratePct).toBe('15');
  });

  it('ignores a stored tariff and falls to the category rule when there is no synced rate', async () => {
    // With no order rate and no synced rate, the chain falls to the category rule, never
    // the tariff band covering the order date.
    const parcel = await seedMelontikParcel();
    await prisma.orderItem.updateMany({
      where: { orderId: parcel.orderId },
      data: { orderCommissionRatePct: null },
    });
    await prisma.marketplaceCommissionRate.create({
      data: {
        platform: 'TRENDYOL',
        ruleKind: 'CATEGORY',
        categoryId: 369n,
        brandId: null,
        categoryName: 'Melontik category',
        parentCategoryName: null,
        brandName: null,
        baseRate: new Decimal('20.00'),
        paymentTermDays: 60,
        segmentOverrides: {},
        fetchedAt: new Date(),
        sourceScreen: 'CategoryCommissionPaymentTerms',
      },
    });
    await seedCoveringTariffBand(parcel, '7');

    const loaded = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });

    const result = estimateTrendyolParcel(loaded.estimateInput);
    const commissionA = result.lines.find(
      (line) => line.type === ProfitLineType.COMMISSION && line.orderItemId === parcel.itemA,
    );
    // The band (7%) is never consulted; the category rule (20%) wins.
    expect(commissionA?.inputs.rateSource).toBe('CATEGORY');
    expect(commissionA?.inputs.ratePct).toBe('20');
  });

  it('counts accepted claim units as accepted returns', async () => {
    const parcel = await seedMelontikParcel();

    const claim = await prisma.orderClaim.create({
      data: {
        organizationId: parcel.organizationId,
        storeId: parcel.storeId,
        orderId: parcel.orderId,
        marketplaceClaimId: `claim-${randomUUID().slice(0, 8)}`,
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
          marketplaceClaimItemId: `acc-${randomUUID()}`,
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
        marketplaceClaimItemId: `rej-${randomUUID()}`,
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
      data: { name: 'HB Org', slug: `hb-${randomUUID().slice(0, 8)}` },
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

  it('prices the order with the tariff version in force at its order date', async () => {
    // A dedicated carrier with two dated versions: v1 is open towards the past (Barem
    // supported, one band, desi 1 = 55.00) and v2 starts on 1 December 2026 at 00:00
    // in Istanbul (no Barem, desi 1 = 99.00). The same order is loaded with its order
    // date one millisecond before v2 starts and exactly at v2's start, so the loaded
    // tariff must follow the order date -- never the moment the order is loaded.
    const carrierCode = 'TEST_ORDER_DATE_VERSION';
    const cargoProviderName = 'Test Order Date Kargo Marketplace';
    const deleteCarrier = async (): Promise<void> => {
      // Versions, desi and Barem rows cascade.
      await prisma.shippingCarrier.deleteMany({
        where: { platform: Platform.TRENDYOL, code: carrierCode },
      });
    };
    await deleteCarrier();

    try {
      await upsertCarrierWithTariffVersions({
        code: carrierCode,
        externalId: 990_016,
        displayName: 'Test Order Date Kargo',
        orderCargoNames: [cargoProviderName],
        versions: [
          {
            effectiveFrom: new Date('2000-01-01T00:00:00.000Z'),
            supportsBaremDestek: true,
            maxBaremDesi: 10,
            desiRows: [{ desi: 1, priceNet: '55.00' }],
            baremRows: [{ minOrderAmount: '0.00', maxOrderAmount: '5000.00', priceNet: '44.00' }],
          },
          {
            effectiveFrom: new Date('2026-11-30T21:00:00.000Z'),
            supportsBaremDestek: false,
            maxBaremDesi: 10,
            desiRows: [{ desi: 1, priceNet: '99.00' }],
            baremRows: [],
          },
        ],
      });
      const parcel = await seedMelontikParcel();

      /** The shipping tariff loaded for the parcel's order dated `orderDate`. */
      async function shippingTariffAt(orderDate: Date): Promise<TrendyolShippingTariff> {
        await prisma.order.update({
          where: { id: parcel.orderId },
          data: { orderDate, cargoProviderName },
        });
        const loaded = await loadTrendyolParcel(prisma, {
          organizationId: parcel.organizationId,
          orderId: parcel.orderId,
        });
        return loaded.estimateInput.reference.shipping;
      }

      const beforeV2 = await shippingTariffAt(new Date('2026-11-30T20:59:59.999Z'));
      expect(beforeV2.carrier?.code).toBe(carrierCode);
      expect(beforeV2.carrier?.supportsBarem).toBe(true);
      expect(beforeV2.desiTariffNet.get('1')?.toFixed(2)).toBe('55.00');
      expect(beforeV2.baremBands).toHaveLength(1);
      expect(beforeV2.baremBands[0]?.priceNet.toFixed(2)).toBe('44.00');

      const atV2 = await shippingTariffAt(new Date('2026-11-30T21:00:00.000Z'));
      expect(atV2.carrier?.code).toBe(carrierCode);
      expect(atV2.carrier?.supportsBarem).toBe(false);
      expect(atV2.desiTariffNet.get('1')?.toFixed(2)).toBe('99.00');
      expect(atV2.baremBands).toHaveLength(0);
    } finally {
      await deleteCarrier();
    }
  });

  it('passes the order agreed ship-by date to the estimate attributes', async () => {
    const parcel = await seedMelontikParcel();
    const load = async (): Promise<Date | null> => {
      const loaded = await loadTrendyolParcel(prisma, {
        organizationId: parcel.organizationId,
        orderId: parcel.orderId,
      });
      return loaded.estimateInput.attributes.agreedDeliveryDate;
    };

    expect(await load()).toBeNull();

    // Trendyol's ship-by deadline: Istanbul 23:59 of the order day.
    const agreedDeliveryDate = new Date('2026-10-28T20:59:00.000Z');
    await prisma.order.update({ where: { id: parcel.orderId }, data: { agreedDeliveryDate } });
    expect(await load()).toEqual(agreedDeliveryDate);
  });

  describe('Barem table 1 / table 2 end to end', () => {
    // A dedicated carrier whose single version carries both Barem tables (one band each,
    // wide enough for the melontik basket 871.75 and its returned item A 491.28) and
    // prices Barem returns at table 1. Desi prices differ from both tables, so every
    // assertion tells Barem table 1, table 2 and the desi tariff apart.
    const carrierCode = 'TEST_TWO_TIER_E2E';
    const cargoProviderName = 'Test Two Tier Kargo Marketplace';
    // The melontik order's ship-by deadline: Istanbul 23:59 of its order day.
    const AGREED = new Date('2026-10-28T20:59:00.000Z');
    const SHIPPED_ON_TIME = new Date('2026-10-28T15:00:00.000Z');
    const SHIPPED_LATE = new Date('2026-10-29T08:00:00.000Z');

    async function deleteCarrier(): Promise<void> {
      // Versions, desi and Barem rows cascade.
      await prisma.shippingCarrier.deleteMany({
        where: { platform: Platform.TRENDYOL, code: carrierCode },
      });
    }

    beforeAll(async () => {
      await deleteCarrier();
      await upsertCarrierWithTariffVersions({
        code: carrierCode,
        externalId: 990_017,
        displayName: 'Test Two Tier Kargo',
        orderCargoNames: [cargoProviderName],
        versions: [
          {
            effectiveFrom: new Date('2000-01-01T00:00:00.000Z'),
            supportsBaremDestek: true,
            maxBaremDesi: 10,
            baremAppliesToReturns: true,
            desiRows: [
              { desi: 1, priceNet: '60.00' },
              { desi: 2, priceNet: '80.00' },
            ],
            baremRows: [
              {
                tier: BaremTier.TABLE_1,
                minOrderAmount: '0.00',
                maxOrderAmount: '5000.00',
                priceNet: '40.00',
              },
              {
                tier: BaremTier.TABLE_2,
                minOrderAmount: '0.00',
                maxOrderAmount: '5000.00',
                priceNet: '70.00',
              },
            ],
          },
        ],
      });
    });

    afterAll(async () => {
      await deleteCarrier();
    });

    /** A fast-delivery melontik order on the two-tier carrier, shipped at `actualShipDate`. */
    async function seedTwoTierOrder(actualShipDate: Date): Promise<MelontikParcel> {
      const parcel = await seedMelontikParcel({ fastDelivery: true });
      await prisma.order.update({
        where: { id: parcel.orderId },
        data: { cargoProviderName, agreedDeliveryDate: AGREED, actualShipDate },
      });
      return parcel;
    }

    /** Records an accepted return of item A (the melontik parcel's desi-1 item). */
    async function acceptReturnOfItemA(parcel: MelontikParcel): Promise<void> {
      const claim = await prisma.orderClaim.create({
        data: {
          organizationId: parcel.organizationId,
          storeId: parcel.storeId,
          orderId: parcel.orderId,
          marketplaceClaimId: `claim-${randomUUID().slice(0, 8)}`,
          claimDate: new Date(),
          resolved: false,
        },
      });
      await prisma.orderClaimItem.create({
        data: {
          claimId: claim.id,
          orderItemId: parcel.itemA,
          marketplaceClaimItemId: `acc-${randomUUID()}`,
          reasonCode: 'DAMAGEDITEM',
          reasonName: 'reason',
          status: 'Accepted',
          acceptedBySeller: true,
          resolved: true,
        },
      });
    }

    async function computedLines(parcel: MelontikParcel): Promise<readonly ProfitLine[]> {
      const computed = await computeParcelProfit(prisma, {
        organizationId: parcel.organizationId,
        orderId: parcel.orderId,
      });
      return computed.lines;
    }

    it('prices an order shipped by its ship-by date at table 1', async () => {
      const parcel = await seedTwoTierOrder(SHIPPED_ON_TIME);

      const shipping = requireLine(await computedLines(parcel), ProfitLineType.SHIPPING, null);
      // Table 1: 40.00 net x 1.20 = 48.00 gross.
      expect(shipping.amount.gross.toFixed(2)).toBe('48.00');
      expect(shipping.inputs).toMatchObject({
        tariffKind: 'BAREM',
        baremTier: BaremTier.TABLE_1,
        shipTiming: 'ON_TIME',
      });
    });

    it('prices an order shipped after its ship-by date at table 2', async () => {
      const parcel = await seedTwoTierOrder(SHIPPED_LATE);

      const shipping = requireLine(await computedLines(parcel), ProfitLineType.SHIPPING, null);
      // Table 2: 70.00 net x 1.20 = 84.00 gross.
      expect(shipping.amount.gross.toFixed(2)).toBe('84.00');
      expect(shipping.inputs).toMatchObject({
        tariffKind: 'BAREM',
        baremTier: BaremTier.TABLE_2,
        shipTiming: 'LATE',
      });
    });

    it('prices the return of an order that went out at table 1 at table 1', async () => {
      const parcel = await seedTwoTierOrder(SHIPPED_ON_TIME);
      await acceptReturnOfItemA(parcel);

      const returnShipping = requireLine(
        await computedLines(parcel),
        ProfitLineType.RETURN_SHIPPING,
        null,
      );
      // Returned sale 491.28 in the table 1 band: 40.00 net x 1.20 = 48.00 gross.
      expect(returnShipping.amount.gross.toFixed(2)).toBe('48.00');
      expect(returnShipping.inputs).toMatchObject({
        tariffKind: 'BAREM',
        baremTier: BaremTier.TABLE_1,
      });
    });

    it('prices the return of an order that went out at table 2 at the desi tariff', async () => {
      const parcel = await seedTwoTierOrder(SHIPPED_LATE);
      await acceptReturnOfItemA(parcel);

      const returnShipping = requireLine(
        await computedLines(parcel),
        ProfitLineType.RETURN_SHIPPING,
        null,
      );
      // Return desi 1: 60.00 net x 1.20 = 72.00 gross.
      expect(returnShipping.amount.gross.toFixed(2)).toBe('72.00');
      expect(returnShipping.inputs).toMatchObject({ tariffKind: 'DESI', baremTier: null });
    });
  });

  it('resolves the micro-export fees and overseas return tiers for an export order', async () => {
    const parcel = await seedMelontikParcel({ isExportSale: true });
    // The international-service fee definition the export path resolves.
    await prisma.feeDefinition.create({
      data: {
        platform: 'TRENDYOL',
        feeType: 'INTERNATIONAL_SERVICE',
        displayName: 'Uluslararasi Hizmet Bedeli',
        calculationKind: 'RATE_OF_SALE',
        rateOfSale: '0.0600',
        defaultVatRate: '20.00',
        effectiveFrom: new Date('2024-01-01T00:00:00Z'),
      },
    });

    const loaded = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });

    const fees = loaded.estimateInput.reference.fees;
    expect(loaded.estimateInput.snapshot.isExportSale).toBe(true);
    // rateOfSale 0.0600 -> 6%.
    expect(fees.internationalServiceRatePct?.toFixed(2)).toBe('6.00');
    expect(fees.internationalServiceVatRatePct?.toFixed(2)).toBe('20.00');
    expect(loaded.loadIssues).toEqual([]);

    // Seeded tiers: rate 0.3500 -> 35, 0.3000 -> 30 (rate x 100).
    const tierByMin = new Map(
      fees.overseasReturnTiers.map((tier) => [tier.minUnitSaleGross.toFixed(2), tier]),
    );
    expect(tierByMin.get('0.00')?.ratePct.toFixed(0)).toBe('35');
    expect(tierByMin.get('2000.01')?.ratePct.toFixed(0)).toBe('30');
  });

  it('uses the micro-export tier version in force at its order date', async () => {
    // A micro-export tier version starting on 1 December 2026 at 00:00 in Istanbul
    // with a single band (rate 0.2500) retires the two seeded bands. The same export
    // order is loaded with its order date one millisecond before that start and
    // exactly at it, so the loaded tiers must follow the order date -- never the
    // moment the order is loaded.
    const microVersionStart = new Date('2026-11-30T21:00:00.000Z');
    const deleteMicroVersion = async (): Promise<void> => {
      // Its tiers cascade.
      await prisma.microExportReturnFeeTierVersion.deleteMany({
        where: { effectiveFrom: microVersionStart },
      });
    };
    await deleteMicroVersion();

    try {
      await prisma.microExportReturnFeeTierVersion.create({
        data: {
          effectiveFrom: microVersionStart,
          tiers: {
            create: [{ minSaleGross: '0.00', maxSaleGross: '99999999.99', rate: '0.2500' }],
          },
        },
      });
      const parcel = await seedMelontikParcel({ isExportSale: true });
      // The international-service fee definition the export path resolves.
      await prisma.feeDefinition.create({
        data: {
          platform: 'TRENDYOL',
          feeType: 'INTERNATIONAL_SERVICE',
          displayName: 'Uluslararasi Hizmet Bedeli',
          calculationKind: 'RATE_OF_SALE',
          rateOfSale: '0.0600',
          defaultVatRate: '20.00',
          effectiveFrom: new Date('2024-01-01T00:00:00Z'),
        },
      });

      /** The overseas return tier rates loaded for the parcel's order dated `orderDate`. */
      async function overseasReturnRatesAt(orderDate: Date): Promise<string[]> {
        await prisma.order.update({
          where: { id: parcel.orderId },
          data: { orderDate },
        });
        const loaded = await loadTrendyolParcel(prisma, {
          organizationId: parcel.organizationId,
          orderId: parcel.orderId,
        });
        return loaded.estimateInput.reference.fees.overseasReturnTiers.map((tier) =>
          tier.ratePct.toString(),
        );
      }

      // Seeded tiers: rate 0.3500 -> 35, 0.3000 -> 30 (rate x 100).
      expect(await overseasReturnRatesAt(new Date('2026-11-30T20:59:59.999Z'))).toEqual([
        '35',
        '30',
      ]);
      // The new version's single band: rate 0.2500 -> 25.
      expect(await overseasReturnRatesAt(new Date('2026-11-30T21:00:00.000Z'))).toEqual(['25']);
    } finally {
      await deleteMicroVersion();
    }
  });

  it('loads a return settlement record and return cargo item matched through a claim', async () => {
    const returnTracking = BigInt('7330000001');
    const returnPackageId = 'return-pkg-1';
    const parcel = await seedMelontikParcel();
    const base = { storeId: parcel.storeId, organizationId: parcel.organizationId } as const;

    await prisma.orderClaim.create({
      data: {
        organizationId: parcel.organizationId,
        storeId: parcel.storeId,
        orderId: parcel.orderId,
        marketplaceClaimId: `claim-${randomUUID().slice(0, 8)}`,
        claimDate: new Date(),
        resolved: false,
        orderShipmentPackageId: returnPackageId,
        cargoTrackingNumber: returnTracking,
      },
    });

    // A SETTLEMENT record on the claim's return package id.
    await insertFinanceRecord({
      ...base,
      family: 'SETTLEMENT',
      transactionType: 'Return',
      recordId: 'return-settle',
      shipmentPackageId: returnPackageId,
      barcode: MELONTIK.items.a.barcode,
      debt: '491.28',
    });
    // A cargo item matched via the claim's cargo tracking number.
    await insertFinanceRecord({
      ...base,
      family: 'CARGO_INVOICE_ITEM',
      transactionType: TRENDYOL_CARGO_RETURN_ITEM_TYPE,
      recordId: 'return-cargo',
      parcelUniqueId: returnTracking.toString(),
      invoiceSerial: 'INV-RET',
      amountGross: '42.00',
      desi: '2',
    });

    const loaded = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });

    expect(loaded.loadIssues).toEqual([]);
    expect(loaded.records.map((r) => r.recordId)).toContain('return-settle');
    const cargo = loaded.cargoItems.find((c) => c.parcelUniqueId === returnTracking.toString());
    expect(cargo?.invoiceSerial).toBe('INV-RET');
    expect(cargo?.itemType).toBe(TRENDYOL_CARGO_RETURN_ITEM_TYPE);
    expect(cargo?.amountGross.toFixed(2)).toBe('42.00');
  });

  it('ignores another store PaymentOrder and cargo item that share the parcel keys', async () => {
    const tracking = BigInt('7330000002');
    const parcel = await seedMelontikParcel({ cargoTrackingNumber: tracking });
    const base = { storeId: parcel.storeId, organizationId: parcel.organizationId } as const;
    const otherStoreId = await createAdditionalStore({
      organizationId: parcel.organizationId,
      name: 'Rival Store',
    });

    // This store's sale carries the payment order id (so the loader runs the
    // PaymentOrder query at all).
    await insertFinanceRecord({
      ...base,
      family: 'SETTLEMENT',
      transactionType: 'Sale',
      recordId: 'sale-a',
      shipmentPackageId: parcel.platformOrderId,
      barcode: MELONTIK.items.a.barcode,
      credit: '529.00',
      paymentOrderId: MELONTIK.paymentOrderId,
    });
    // Another store's PaymentOrder with the same paymentOrderId must NOT load.
    await insertFinanceRecord({
      storeId: otherStoreId,
      organizationId: parcel.organizationId,
      family: 'OTHER_FINANCIAL',
      transactionType: 'PaymentOrder',
      recordId: 'other-po',
      paymentOrderId: MELONTIK.paymentOrderId,
    });
    // Another store's cargo item with the same parcelUniqueId must NOT load.
    await insertFinanceRecord({
      storeId: otherStoreId,
      organizationId: parcel.organizationId,
      family: 'CARGO_INVOICE_ITEM',
      transactionType: TRENDYOL_CARGO_OUTBOUND_ITEM_TYPE,
      recordId: 'other-cargo',
      parcelUniqueId: tracking.toString(),
      invoiceSerial: 'INV-X',
      amountGross: '10.00',
    });

    const loaded = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });

    expect(loaded.records.map((r) => r.recordId)).toEqual(['sale-a']);
    expect(loaded.records.every((r) => r.transactionType !== 'PaymentOrder')).toBe(true);
    expect(loaded.cargoItems).toHaveLength(0);
  });

  it('binds a package-less settlement record by order number and barcode', async () => {
    const orderNumber = 'ORDER-4B-BIND';
    const parcel = await seedMelontikParcel();
    await prisma.order.update({
      where: { id: parcel.orderId },
      data: { platformOrderNumber: orderNumber },
    });
    const base = { storeId: parcel.storeId, organizationId: parcel.organizationId } as const;

    // A Return carrying no shipment package id, named only by its order number and
    // barcode: the third binding layer must reach it (Gorev 4B).
    await insertFinanceRecord({
      ...base,
      family: 'SETTLEMENT',
      transactionType: 'Return',
      recordId: 'ret-packageless',
      shipmentPackageId: null,
      orderNumber,
      barcode: MELONTIK.items.a.barcode,
      debt: '491.28',
      commissionAmount: '93.34',
    });

    const loaded = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });

    expect(loaded.loadIssues).toEqual([]);
    expect(loaded.records.map((r) => r.recordId)).toContain('ret-packageless');

    // Driven through the estimate + mapper, the bound return nets a SALE_RETURN line.
    const estimate = estimateTrendyolParcel(loaded.estimateInput);
    const mapped = mapTrendyolRecords({
      snapshot: loaded.estimateInput.snapshot,
      attributes: loaded.estimateInput.attributes,
      fees: loaded.estimateInput.reference.fees,
      shippingTariffSource: loaded.estimateInput.reference.shipping.source,
      records: loaded.records,
      cargoItems: loaded.cargoItems,
      estimateLines: estimate.lines,
    });
    const saleReturn = mapped.lines.find(
      (line) => line.type === ProfitLineType.SALE_RETURN && line.orderItemId === parcel.itemA,
    );
    expect(saleReturn?.amount.gross.toFixed(2)).toBe('491.28');
  });

  it('leaves a package-less record unbound when two parcels of the order carry its barcode', async () => {
    const orderNumber = 'ORDER-4B-SPLIT';
    const parcel = await seedMelontikParcel();
    await prisma.order.update({
      where: { id: parcel.orderId },
      data: { platformOrderNumber: orderNumber },
    });
    const base = { storeId: parcel.storeId, organizationId: parcel.organizationId } as const;

    // A second parcel of the same order number (a split shipment) that also carries
    // item A's barcode: the record cannot be attributed to one parcel over the other.
    const siblingOrder = await prisma.order.create({
      data: {
        organizationId: parcel.organizationId,
        storeId: parcel.storeId,
        platformOrderId: `sibling-${randomUUID().slice(0, 8)}`,
        platformOrderNumber: orderNumber,
        orderDate: MELONTIK.orderDate,
        status: 'DELIVERED',
      },
    });
    await prisma.orderItem.create({
      data: {
        orderId: siblingOrder.id,
        organizationId: parcel.organizationId,
        quantity: 1,
        barcode: MELONTIK.items.a.barcode,
        lineListGross: '100.00',
        lineSaleGross: '100.00',
        lineSellerDiscountGross: '0',
        saleVatRate: '10',
      },
    });

    await insertFinanceRecord({
      ...base,
      family: 'SETTLEMENT',
      transactionType: 'Return',
      recordId: 'ret-ambiguous',
      shipmentPackageId: null,
      orderNumber,
      barcode: MELONTIK.items.a.barcode,
      debt: '491.28',
    });

    const loadedPrimary = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });
    const loadedSibling = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: siblingOrder.id,
    });

    // Neither parcel's load picks up the ambiguous record.
    expect(loadedPrimary.records.map((r) => r.recordId)).not.toContain('ret-ambiguous');
    expect(loadedSibling.records.map((r) => r.recordId)).not.toContain('ret-ambiguous');
    // No spurious issue is raised for the sibling parcels either.
    expect(loadedPrimary.loadIssues).toEqual([]);
    expect(loadedSibling.loadIssues).toEqual([]);
  });

  it('does not bind a record whose package id is set but matches nothing', async () => {
    const orderNumber = 'ORDER-4B-SETPKG';
    const parcel = await seedMelontikParcel();
    await prisma.order.update({
      where: { id: parcel.orderId },
      data: { platformOrderNumber: orderNumber },
    });
    const base = { storeId: parcel.storeId, organizationId: parcel.organizationId } as const;

    // A non-null shipment package id that matches no outbound package and no claim's
    // return package. The order number and barcode match, but a set-but-unmatched
    // package id is never guessed by the order-number layer.
    await insertFinanceRecord({
      ...base,
      family: 'SETTLEMENT',
      transactionType: 'Return',
      recordId: 'ret-wrong-pkg',
      shipmentPackageId: 'unknown-package-id',
      orderNumber,
      barcode: MELONTIK.items.a.barcode,
      debt: '491.28',
    });

    const loaded = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });

    expect(loaded.records.map((r) => r.recordId)).not.toContain('ret-wrong-pkg');
    expect(loaded.records).toHaveLength(0);
  });

  it("never binds another store's package-less record", async () => {
    const orderNumber = 'ORDER-4B-STORE';
    const parcel = await seedMelontikParcel();
    await prisma.order.update({
      where: { id: parcel.orderId },
      data: { platformOrderNumber: orderNumber },
    });
    const otherStoreId = await createAdditionalStore({
      organizationId: parcel.organizationId,
      name: 'Rival Store',
    });

    // Same order number and barcode, but the record lives in another store: the
    // store-scoped candidate query must never reach it.
    await insertFinanceRecord({
      storeId: otherStoreId,
      organizationId: parcel.organizationId,
      family: 'SETTLEMENT',
      transactionType: 'Return',
      recordId: 'ret-other-store',
      shipmentPackageId: null,
      orderNumber,
      barcode: MELONTIK.items.a.barcode,
      debt: '491.28',
    });

    const loaded = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });

    expect(loaded.records.map((r) => r.recordId)).not.toContain('ret-other-store');
    expect(loaded.records).toHaveLength(0);
  });

  it('does not bind a package-less sale record', async () => {
    const orderNumber = 'ORDER-4B-SALE';
    const parcel = await seedMelontikParcel();
    await prisma.order.update({
      where: { id: parcel.orderId },
      data: { platformOrderNumber: orderNumber },
    });
    const base = { storeId: parcel.storeId, organizationId: parcel.organizationId } as const;

    // A Sale carrying no shipment package id but the parcel's order number and barcode.
    // Only return-leg types bind package-less; a Sale always carries its package in real
    // data, so binding one here would double-count the sale a package-bound Sale row holds.
    await insertFinanceRecord({
      ...base,
      family: 'SETTLEMENT',
      transactionType: 'Sale',
      recordId: 'sale-packageless',
      shipmentPackageId: null,
      orderNumber,
      barcode: MELONTIK.items.a.barcode,
      credit: '491.28',
      commissionAmount: '93.34',
    });

    const loaded = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });

    expect(loaded.records.map((r) => r.recordId)).not.toContain('sale-packageless');
    expect(loaded.records).toHaveLength(0);
  });

  it('ignores a namesake order of another store in the sibling check', async () => {
    const orderNumber = 'ORDER-4B-NAMESAKE';
    const parcel = await seedMelontikParcel();
    await prisma.order.update({
      where: { id: parcel.orderId },
      data: { platformOrderNumber: orderNumber },
    });
    const base = { storeId: parcel.storeId, organizationId: parcel.organizationId } as const;

    // Another store owns an order with the SAME platform order number and an item with the
    // SAME barcode. The sibling check must reach only this store's orders, so the namesake
    // never makes the record ambiguous: the record still binds to this store's parcel.
    const otherStoreId = await createAdditionalStore({
      organizationId: parcel.organizationId,
      name: 'Rival Store',
    });
    const namesakeOrder = await prisma.order.create({
      data: {
        organizationId: parcel.organizationId,
        storeId: otherStoreId,
        platformOrderId: `namesake-${randomUUID().slice(0, 8)}`,
        platformOrderNumber: orderNumber,
        orderDate: MELONTIK.orderDate,
        status: 'DELIVERED',
      },
    });
    await prisma.orderItem.create({
      data: {
        orderId: namesakeOrder.id,
        organizationId: parcel.organizationId,
        quantity: 1,
        barcode: MELONTIK.items.a.barcode,
        lineListGross: '100.00',
        lineSaleGross: '100.00',
        lineSellerDiscountGross: '0',
        saleVatRate: '10',
      },
    });

    await insertFinanceRecord({
      ...base,
      family: 'SETTLEMENT',
      transactionType: 'Return',
      recordId: 'ret-namesake',
      shipmentPackageId: null,
      orderNumber,
      barcode: MELONTIK.items.a.barcode,
      debt: '491.28',
    });

    const loaded = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });

    expect(loaded.loadIssues).toEqual([]);
    expect(loaded.records.map((r) => r.recordId)).toContain('ret-namesake');
  });

  it('skips package-less binding when the order has no order number', async () => {
    // seedMelontikParcel leaves platform_order_number null: there is no key to bind a
    // package-less row on, so the loader must skip the binding entirely without erroring.
    const parcel = await seedMelontikParcel();
    const base = { storeId: parcel.storeId, organizationId: parcel.organizationId } as const;

    await insertFinanceRecord({
      ...base,
      family: 'SETTLEMENT',
      transactionType: 'Return',
      recordId: 'ret-no-order-number',
      shipmentPackageId: null,
      orderNumber: 'SOME-ORDER-NUMBER',
      barcode: MELONTIK.items.a.barcode,
      debt: '491.28',
    });

    const loaded = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });

    expect(loaded.loadIssues).toEqual([]);
    expect(loaded.records.map((r) => r.recordId)).not.toContain('ret-no-order-number');
    expect(loaded.records).toHaveLength(0);
  });

  it('falls back to the standard fee for a non-same-day parcel with no fast definition', async () => {
    const parcel = await seedMelontikParcel();
    // Remove the PLATFORM_SERVICE_FAST definition entirely.
    await prisma.feeDefinition.deleteMany({
      where: { platform: 'TRENDYOL', feeType: 'PLATFORM_SERVICE_FAST' },
    });

    const loaded = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });

    const fees = loaded.estimateInput.reference.fees;
    // Non-same-day: the same-day net falls back to the standard net (10.99), no issue.
    expect(fees.psfSameDayNet?.toFixed(2)).toBe('10.99');
    expect(fees.psfSameDayNet?.toFixed(2)).toBe(fees.psfStandardNet?.toFixed(2));
    expect(loaded.loadIssues).toEqual([]);
  });

  it('records missing reference data when a same-day parcel has no fast fee definition', async () => {
    // Formerly a FeeDefinitionNotFoundError that left the order without any statement; now
    // the loader records the missing definition and leaves the same-day net empty.
    const parcel = await seedMelontikParcel({
      fastDelivery: true,
      fastDeliveryType: TRENDYOL_SAME_DAY_SHIPPING_TYPE,
    });
    await prisma.feeDefinition.deleteMany({
      where: { platform: 'TRENDYOL', feeType: 'PLATFORM_SERVICE_FAST' },
    });

    const loaded = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });

    expect(loaded.loadIssues).toEqual([
      {
        code: ProfitIssueCode.REFERENCE_DATA_MISSING,
        orderItemId: null,
        detail: 'FEE:PLATFORM_SERVICE_FAST',
      },
    ]);
    const fees = loaded.estimateInput.reference.fees;
    expect(fees.psfSameDayNet).toBeNull();
    expect(fees.psfStandardNet?.toFixed(2)).toBe('10.99');
  });

  it('leaves out the platform service fee whose definition is missing and blocks the profit', async () => {
    const parcel = await seedMelontikParcel();
    await prisma.feeDefinition.deleteMany({
      where: { platform: 'TRENDYOL', feeType: 'PLATFORM_SERVICE' },
    });

    const loaded = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });
    expect(loaded.loadIssues).toEqual([
      {
        code: ProfitIssueCode.REFERENCE_DATA_MISSING,
        orderItemId: null,
        detail: 'FEE:PLATFORM_SERVICE',
      },
    ]);
    expect(loaded.estimateInput.reference.fees.psfStandardNet).toBeNull();
    expect(loaded.estimateInput.reference.fees.psfVatRatePct).toBeNull();

    const computed = await computeParcelProfit(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });
    const types = computed.lines.map((line) => line.type);
    expect(types).not.toContain(ProfitLineType.SERVICE_FEE);
    expect(types).toContain(ProfitLineType.COMMISSION);
    expect(types).toContain(ProfitLineType.SHIPPING);
    for (const statement of [computed.estimate, computed.bestKnown]) {
      expect(statement.status).toBe(ProfitStatus.NOT_COMPUTABLE);
      expect(statement.netProfit).toBeNull();
      expect(statement.issues).toContainEqual({
        code: ProfitIssueCode.REFERENCE_DATA_MISSING,
        orderItemId: null,
        detail: 'FEE:PLATFORM_SERVICE',
      });
    }
  });

  it('records an incomplete fee definition the same way, keeping its VAT rate', async () => {
    // A PLATFORM_SERVICE definition without its fixed amount (formerly an
    // IncompleteFeeDefinitionError): one REFERENCE_DATA_MISSING, the net empty.
    const parcel = await seedMelontikParcel();
    await prisma.feeDefinition.updateMany({
      where: { platform: 'TRENDYOL', feeType: 'PLATFORM_SERVICE' },
      data: { fixedAmountNet: null },
    });

    const loaded = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });

    expect(loaded.loadIssues).toEqual([
      {
        code: ProfitIssueCode.REFERENCE_DATA_MISSING,
        orderItemId: null,
        detail: 'FEE:PLATFORM_SERVICE',
      },
    ]);
    expect(loaded.estimateInput.reference.fees.psfStandardNet).toBeNull();
    expect(loaded.estimateInput.reference.fees.psfVatRatePct?.toFixed(2)).toBe('20.00');
  });

  it('computes an order dated before every fee definition without throwing', async () => {
    // A store whose history predates the first fee definitions: platform service,
    // stoppage, commission VAT and shipping VAT are all missing. Each is recorded once; no
    // line needs a missing value, estimate or actual -- the settled commission and the cargo
    // invoice included -- and both views come out not computable.
    const tracking = BigInt('7335552222');
    const parcel = await seedMelontikParcel({ cargoTrackingNumber: tracking });
    await prisma.feeDefinition.deleteMany({});
    for (const record of melontikSaleCycleRecordInputs(parcel)) {
      await insertFinanceRecord(record);
    }
    await insertFinanceRecord(melontikCargoInvoiceInput(parcel, tracking.toString()));

    const computed = await computeParcelProfit(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });

    const types = computed.lines.map((line) => line.type);
    for (const missing of [
      ProfitLineType.SERVICE_FEE,
      ProfitLineType.STOPPAGE,
      ProfitLineType.COMMISSION,
      ProfitLineType.SHIPPING,
    ]) {
      expect(types).not.toContain(missing);
    }
    // The sale is still written, estimated and settled.
    expect(
      computed.lines
        .filter((line) => line.type === ProfitLineType.SALE)
        .map((line) => line.certainty)
        .sort(),
    ).toEqual([
      ProfitLineCertainty.ACTUAL,
      ProfitLineCertainty.ACTUAL,
      ProfitLineCertainty.ESTIMATE,
      ProfitLineCertainty.ESTIMATE,
    ]);
    for (const statement of [computed.estimate, computed.bestKnown]) {
      expect(statement.status).toBe(ProfitStatus.NOT_COMPUTABLE);
      expect(statement.netProfit).toBeNull();
      expect(
        statement.issues
          .filter((issue) => issue.code === ProfitIssueCode.REFERENCE_DATA_MISSING)
          .map((issue) => issue.detail),
      ).toEqual(['FEE:PLATFORM_SERVICE', 'FEE:STOPPAGE', 'FEE:COMMISSION_INVOICE', 'FEE:SHIPPING']);
    }
  });

  it('does not read fully settled when missing fee definitions leave required slots empty', async () => {
    // Every fee VAT is missing, so the commission, shipping and service fee slots carry no
    // line at all, estimate or actual. The sale records land and no cargo invoice does:
    // without a settlement gap nothing would be pending and reconciliation would read
    // FULLY_SETTLED although the commission and cargo were never reconciled.
    const parcel = await seedMelontikParcel();
    await prisma.feeDefinition.deleteMany({});
    for (const record of melontikSaleCycleRecordInputs(parcel)) {
      await insertFinanceRecord(record);
    }

    const computed = await computeParcelProfit(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });

    const types = computed.bestKnown.selectedLines.map((line) => line.type);
    for (const empty of [
      ProfitLineType.COMMISSION,
      ProfitLineType.SHIPPING,
      ProfitLineType.SERVICE_FEE,
    ]) {
      expect(types).not.toContain(empty);
    }
    expect(computed.bestKnown.reconciliationStatus).toBe(ReconciliationStatus.PARTIALLY_SETTLED);
    expect(computed.bestKnown.status).toBe(ProfitStatus.NOT_COMPUTABLE);
  });

  it('picks the version in effect by effective_from, not by changed_at', async () => {
    const parcel = await seedMelontikParcel();

    // A packaging profile on item A's variant with two versions whose changed_at and
    // effective_from orders disagree on purpose. The 2026-10-28 order date falls
    // between the two effective_from dates, so the version in effect is the one that
    // became effective on 2026-10-01 (300.00); ordering by changed_at would pick the
    // 2026-10-15 version (400.00) instead.
    const profile = await prisma.costProfile.create({
      data: {
        organizationId: parcel.organizationId,
        storeId: parcel.storeId,
        name: 'Packaging two-version',
        type: 'PACKAGING',
        amountGross: '300.00',
        vatRate: '20',
      },
    });
    await prisma.costProfileVersion.create({
      data: {
        profileId: profile.id,
        organizationId: parcel.organizationId,
        version: 1,
        name: profile.name,
        type: 'PACKAGING',
        amountGross: '300.00',
        vatRate: '20',
        changedFields: [],
        changedAt: new Date('2026-11-05T00:00:00Z'), // later changed_at, earlier effective_from
        effectiveFrom: new Date('2026-10-01T00:00:00Z'),
      },
    });
    await prisma.costProfileVersion.create({
      data: {
        profileId: profile.id,
        organizationId: parcel.organizationId,
        version: 2,
        name: profile.name,
        type: 'PACKAGING',
        amountGross: '400.00',
        vatRate: '20',
        changedFields: [],
        changedAt: new Date('2026-10-15T00:00:00Z'), // earlier changed_at, later effective_from
        effectiveFrom: new Date('2026-11-10T00:00:00Z'),
      },
    });
    await prisma.productVariantCostProfile.create({
      data: {
        organizationId: parcel.organizationId,
        productVariantId: parcel.variantA,
        profileId: profile.id,
      },
    });

    const loaded = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });

    const result = estimateTrendyolParcel(loaded.estimateInput);
    const packaging = requireLine(result.lines, ProfitLineType.COST_PACKAGING, parcel.itemA);
    expect(packaging.amount.gross.toFixed(2)).toBe('300.00');
  });

  it("uses the order's own carrier for the shipping estimate", async () => {
    // A carrier with a SHORT display name, the long "... Marketplace" name in
    // orderCargoNames and a cheaper desi tariff is the one Trendyol assigned to this
    // order. The order carries only the long marketplace name (as real orders do), so it
    // matches via orderCargoNames -- not the display name -- and that carrier's tariff
    // drives the estimate. A TEST-prefixed brand (not a canonical one like SENDEOMP)
    // keeps the match unambiguous against the 10 seeded carriers, which now carry their
    // own getProviders names.
    const parcel = await seedMelontikParcel();
    await upsertCarrierWithTariffs({
      code: 'TEST_ORDER_CARRIER',
      displayName: 'Test Kolay Kargo',
      orderCargoNames: ['Test Kolay Kargo Marketplace'],
      externalId: 990010,
      supportsBaremDestek: false,
      maxBaremDesi: 10,
      desiRows: [
        { desi: 1, priceNet: '50.00' },
        { desi: 2, priceNet: '50.00' },
      ],
      baremRows: [],
    });
    await prisma.order.update({
      where: { id: parcel.orderId },
      data: { cargoProviderName: 'Test Kolay Kargo Marketplace' },
    });

    const loaded = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });
    const result = estimateTrendyolParcel(loaded.estimateInput);

    const shipping = requireLine(result.lines, ProfitLineType.SHIPPING, null);
    // 50.00 net x 1.20 VAT = 60.00 gross, from the order's matched carrier.
    expect(shipping.amount.gross.toFixed(2)).toBe('60.00');
    expect(shipping.amount.vat.toFixed(2)).toBe('10.00');
    expect(shipping.inputs.tariffKind).toBe('DESI');
    expect(shipping.inputs.carrierCode).toBe('TEST_ORDER_CARRIER');
  });

  it('does not apply Barem for a carrier outside the Barem program', async () => {
    // The order's matched carrier does NOT support Barem. Even though the order is
    // fast-delivery and its basket sits inside the carrier's band, the estimate must use
    // the carrier's desi tariff, never a Barem band -- because it is outside the program.
    const parcel = await seedMelontikParcel({ fastDelivery: true });

    await upsertCarrierWithTariffs({
      code: 'TEST_ORDER_NOBAREM',
      displayName: 'Test NoBarem Kargo',
      orderCargoNames: ['Test NoBarem Kargo Marketplace'],
      externalId: 990012,
      supportsBaremDestek: false,
      maxBaremDesi: 10,
      desiRows: [
        { desi: 1, priceNet: '70.00' },
        { desi: 2, priceNet: '70.00' },
      ],
      // A band is present on purpose: it must still be skipped because the carrier is
      // outside the Barem program.
      baremRows: [{ minOrderAmount: '0.00', maxOrderAmount: '5000.00', priceNet: '20.00' }],
    });
    await prisma.order.update({
      where: { id: parcel.orderId },
      // The long marketplace name Trendyol writes; it matches via orderCargoNames.
      data: { cargoProviderName: 'Test NoBarem Kargo Marketplace' },
    });

    const loaded = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });
    const result = estimateTrendyolParcel(loaded.estimateInput);

    const shipping = requireLine(result.lines, ProfitLineType.SHIPPING, null);
    // The non-Barem carrier uses its desi tariff: 70.00 net x 1.20 = 84.00 gross, DESI.
    expect(shipping.inputs.tariffKind).toBe('DESI');
    expect(shipping.amount.gross.toFixed(2)).toBe('84.00');
    expect(shipping.inputs.carrierCode).toBe('TEST_ORDER_NOBAREM');
  });

  /** The parcel's estimate for `cargoProviderName`, computed read-only. */
  async function estimateFor(
    cargoProviderName: string | null,
  ): Promise<ReturnType<typeof estimateTrendyolParcel>> {
    const parcel = await seedMelontikParcel();
    await prisma.order.update({
      where: { id: parcel.orderId },
      data: { cargoProviderName },
    });
    const loaded = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });
    return estimateTrendyolParcel(loaded.estimateInput);
  }

  /** Asserts the order got no SHIPPING line and one blocking carrier issue with `detail`. */
  function expectBlockedCarrier(
    result: ReturnType<typeof estimateTrendyolParcel>,
    providerName: string | null,
  ): void {
    expect(result.lines.filter((line) => line.type === ProfitLineType.SHIPPING)).toEqual([]);
    expect(
      result.issues.filter((issue) => issue.code === ProfitIssueCode.CARRIER_NOT_RECOGNIZED),
    ).toEqual([
      { code: ProfitIssueCode.CARRIER_NOT_RECOGNIZED, orderItemId: null, detail: providerName },
    ]);
  }

  it('blocks an order with an unknown carrier name', async () => {
    // Trendyol named a carrier that matches no active carrier (e.g. alternative delivery)
    // on an order shipped under Trendyol's agreement: no SHIPPING line (never the store
    // default, which an order no longer consults, nor a zero line) and a blocking
    // CARRIER_NOT_RECOGNIZED issue, so the order is not computable.
    const parcel = await seedMelontikParcel();
    await prisma.order.update({
      where: { id: parcel.orderId },
      data: { cargoProviderName: 'Alternative Delivery' },
    });

    const computed = await computeParcelProfit(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });

    expect(computed.lines.filter((line) => line.type === ProfitLineType.SHIPPING)).toEqual([]);
    for (const statement of [computed.estimate, computed.bestKnown]) {
      // Exactly one per parcel: the return leg never adds a second one.
      expect(
        statement.issues.filter((issue) => issue.code === ProfitIssueCode.CARRIER_NOT_RECOGNIZED),
      ).toEqual([
        {
          code: ProfitIssueCode.CARRIER_NOT_RECOGNIZED,
          orderItemId: null,
          detail: 'Alternative Delivery',
        },
      ]);
      expect(statement.status).toBe(ProfitStatus.NOT_COMPUTABLE);
      expect(statement.netProfit).toBeNull();
    }
  });

  it('keeps a seller-cargo order with an unknown carrier at a zero shipping line', async () => {
    // Design 6.13: a seller-cargo-agreement order is exempt from the not-recognized carrier
    // rule until PR-6, so its result is unchanged -- a zero SHIPPING estimate, only the
    // seller-cargo warning, and a computable (estimated) profit.
    const parcel = await seedMelontikParcel();
    await prisma.order.update({
      where: { id: parcel.orderId },
      data: { cargoProviderName: 'Alternative Delivery', usesSellerCargoAgreement: true },
    });

    const computed = await computeParcelProfit(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });

    const shipping = requireLine(computed.lines, ProfitLineType.SHIPPING, null);
    expect(shipping.amount.gross.toFixed(2)).toBe('0.00');
    expect(shipping.inputs.reason).toBe(CARRIER_NOT_RECOGNIZED_REASON);
    expect(shipping.inputs.providerName).toBe('Alternative Delivery');
    for (const statement of [computed.estimate, computed.bestKnown]) {
      expect(statement.issues.map((issue) => issue.code)).toEqual([
        ProfitIssueCode.SELLER_CARGO_AGREEMENT_ESTIMATE,
      ]);
      expect(statement.status).toBe(ProfitStatus.ESTIMATED);
      expect(statement.netProfit).not.toBeNull();
    }
  });

  it('blocks an order with an empty carrier name', async () => {
    // Trendyol sent no usable name: the issue records null, never '' (the frontend falls
    // back to its "unknown carrier" label on null only).
    expectBlockedCarrier(await estimateFor(''), null);
  });

  it('reports a null provider name for a whitespace-only carrier name', async () => {
    const parcel = await seedMelontikParcel();
    await prisma.order.update({
      where: { id: parcel.orderId },
      data: { cargoProviderName: '   ' },
    });

    const computed = await computeParcelProfit(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });

    expect(computed.lines.filter((line) => line.type === ProfitLineType.SHIPPING)).toEqual([]);
    expect(
      computed.bestKnown.issues.filter(
        (issue) => issue.code === ProfitIssueCode.CARRIER_NOT_RECOGNIZED,
      ),
    ).toEqual([{ code: ProfitIssueCode.CARRIER_NOT_RECOGNIZED, orderItemId: null, detail: null }]);
  });

  it('blocks an order with an ambiguous carrier name', async () => {
    // Two distinct active carriers both claim the order's cargo name: the match is
    // ambiguous, so the carrier is not recognized and the order gets no shipping line.
    const parcel = await seedMelontikParcel();
    for (const code of ['TEST_AMBIG_A', 'TEST_AMBIG_B']) {
      await upsertCarrierWithTariffs({
        code,
        displayName: `${code} Display`,
        orderCargoNames: ['Shared Ambiguous Kargo Marketplace'],
        externalId: code === 'TEST_AMBIG_A' ? 990014 : 990015,
        supportsBaremDestek: false,
        maxBaremDesi: 10,
        desiRows: [{ desi: 2, priceNet: '50.00' }],
        baremRows: [],
      });
    }
    await prisma.order.update({
      where: { id: parcel.orderId },
      data: { cargoProviderName: 'Shared Ambiguous Kargo Marketplace' },
    });

    const loaded = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });
    expectBlockedCarrier(
      estimateTrendyolParcel(loaded.estimateInput),
      'Shared Ambiguous Kargo Marketplace',
    );
  });

  it('blocks an order whose carrier name only an inactive carrier claims', async () => {
    // An INACTIVE carrier whose orderCargoNames contains the order's cargo name is dropped
    // by the active-only query, so the order's carrier is not recognized -- no shipping
    // line, never the inactive namesake's cheap 50.00 -> 60.00 tariff.
    const parcel = await seedMelontikParcel();
    await upsertCarrierWithTariffs({
      code: 'TEST_INACTIVE_NAMESAKE',
      displayName: 'Test Inactive Kargo',
      orderCargoNames: ['Test Inactive Kargo Marketplace'],
      externalId: 990013,
      supportsBaremDestek: false,
      maxBaremDesi: 10,
      desiRows: [
        { desi: 1, priceNet: '50.00' },
        { desi: 2, priceNet: '50.00' },
      ],
      baremRows: [],
    });
    // Flip it inactive (the helper always upserts an active carrier).
    await prisma.shippingCarrier.update({
      where: { platform_code: { platform: 'TRENDYOL', code: 'TEST_INACTIVE_NAMESAKE' } },
      data: { active: false },
    });
    await prisma.order.update({
      where: { id: parcel.orderId },
      data: { cargoProviderName: 'Test Inactive Kargo Marketplace' },
    });

    const loaded = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });
    expectBlockedCarrier(
      estimateTrendyolParcel(loaded.estimateInput),
      'Test Inactive Kargo Marketplace',
    );
  });

  it('prices an own-contract store normally when the carrier is not recognized', async () => {
    // OWN_CONTRACT tariffs are store-level and carrier-independent, so a not-recognized
    // carrier only means no Barem -- the own desi tariff still prices the shipment, never
    // a zero line.
    const parcel = await seedMelontikParcel();
    await prisma.store.update({
      where: { id: parcel.storeId },
      data: { shippingTariffSource: 'OWN_CONTRACT' },
    });
    await prisma.ownShippingTariff.create({
      data: {
        organizationId: parcel.organizationId,
        storeId: parcel.storeId,
        desi: 2,
        priceNet: '45.00',
      },
    });
    await prisma.order.update({
      where: { id: parcel.orderId },
      data: { cargoProviderName: 'Alternative Delivery' },
    });

    const loaded = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });
    const shipping = requireLine(
      estimateTrendyolParcel(loaded.estimateInput).lines,
      ProfitLineType.SHIPPING,
      null,
    );
    // 45.00 net x 1.20 VAT = 54.00 gross from the own tariff; no zero line.
    expect(shipping.amount.gross.toFixed(2)).toBe('54.00');
    expect(shipping.inputs.tariffKind).toBe('OWN');
    expect(shipping.inputs.reason).toBeUndefined();
  });

  it('keeps seller-cargo shipping an estimate yet settles the rest on a Trendyol-contract store', async () => {
    // Owner decision 2026-11-10: a seller-cargo-agreement order on a Trendyol-contract
    // store keeps its shipping estimate even after the sale payment order lands, and a
    // non-blocking issue says why. That estimate does not hold reconciliation back, so
    // the best-known view settles fully at the golden 191.79 (the shipping amount is the
    // same 98.34 estimate; only its certainty stays ESTIMATE).
    const parcel = await seedMelontikParcel();
    await prisma.order.update({
      where: { id: parcel.orderId },
      data: { usesSellerCargoAgreement: true },
    });
    for (const record of melontikSaleCycleRecordInputs(parcel)) {
      await insertFinanceRecord(record);
    }

    const computed = await computeParcelProfit(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });

    const shippingLines = computed.lines.filter((line) => line.type === ProfitLineType.SHIPPING);
    expect(shippingLines.map((line) => line.certainty)).toEqual([ProfitLineCertainty.ESTIMATE]);
    expect(shippingLines[0]?.amount.gross.toFixed(2)).toBe('98.34');
    expect(computed.bestKnown.issues).toContainEqual({
      code: ProfitIssueCode.SELLER_CARGO_AGREEMENT_ESTIMATE,
      orderItemId: null,
      detail: null,
    });
    expect(computed.bestKnown.reconciliationStatus).toBe(ReconciliationStatus.FULLY_SETTLED);
    expect(computed.bestKnown.status).toBe(ProfitStatus.SETTLED);
    expect(computed.bestKnown.netProfit?.toFixed(2)).toBe('191.79');
  });
});
