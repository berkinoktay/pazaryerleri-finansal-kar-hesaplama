/**
 * Integration tests for the engine reading the order profit snapshot (plan PR-2,
 * Gorev 3): `recomputeParcelProfit` captures the order's product and seller inputs
 * before it computes, and a captured order is priced with those inputs, not the live
 * ones. A later desi correction, synced rate, category rule, cost link, amount or
 * profile type, digital flag, product category or brand, store shipping setting or
 * carrier mapping edit therefore leaves its stored profit as it is.
 *
 * Every live value the suite changes is one the melontik parcel would otherwise
 * price with: the order rates are cleared (so item A resolves its commission from
 * the synced rate and item B from this suite's own category rule), the order uses
 * this suite's own carrier whose desi rows all carry distinct prices, and the new
 * cost version starts before the order date.
 *
 * The suite never truncates: shared reference tables (carriers, commission rules) are
 * touched only through this suite's own TEST_-prefixed carrier and its own category
 * id, which are deleted before every test and at the end. Every test builds a fresh
 * melontik organization; those are deleted at the end (their rows cascade).
 *
 * Requires: `supabase start` + `pnpm db:test-setup` before running.
 */

import { randomUUID } from 'node:crypto';

import { prisma } from '@pazarsync/db';
import {
  CommissionRuleKind,
  CostProfileType,
  Platform,
  ProfitIssueCode,
  ProfitLineType,
  ProfitStatementView,
  ProfitStatus,
  ShippingTariffSource,
} from '@pazarsync/db/enums';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PROFIT_ENGINE_VERSION } from '../../core/engine-version';
import { type ProfitLine } from '../../core/profit-line';
import { computeParcelProfit, type ComputedParcelProfit } from '../compute-parcel-profit';
import { profitContentHash } from '../content-hash';
import { recomputeParcelProfit, type RecomputeParcelResult } from '../recompute-parcel-profit';
import {
  attachCostProfile,
  ensureDbReachable,
  MELONTIK,
  type MelontikParcel,
  seedMelontikParcel,
  upsertCarrierWithTariffs,
} from './helpers/melontik-parcel';

/** This suite's own categories and brands; no seeded commission rule uses them. */
const TEST_CATEGORY_ID = 9_990_801n;
const TEST_BRAND_ID = 9_990_802n;
const TEST_OTHER_CATEGORY_ID = 9_990_803n;
const TEST_OTHER_BRAND_ID = 9_990_804n;
const SUITE_CATEGORY_IDS = [TEST_CATEGORY_ID, TEST_OTHER_CATEGORY_ID];

/** This suite's own carrier (TEST_-prefixed code, unused external id). */
const SNAPSHOT_CARRIER = {
  code: 'TEST_RECOMPUTE_SNAPSHOT',
  externalId: 990_301,
  // The order's cargo name matches only through the mapping list, never the display name.
  orderCargoName: 'Test Recompute Snapshot Kargo Marketplace',
} as const;

/** A distinct price per desi, so any desi change moves the shipping estimate. */
const SNAPSHOT_DESI_ROWS = [
  { desi: 1, priceNet: '50.00' },
  { desi: 2, priceNet: '60.00' },
  { desi: 3, priceNet: '70.00' },
  { desi: 4, priceNet: '80.00' },
  { desi: 5, priceNet: '90.00' },
] as const;

const CATEGORY_RATE = '18.00';
const CATEGORY_BRAND_RATE = '16.50';

/** A cost version start before the melontik order date (2026-10-28): in force at it. */
const BEFORE_ORDER_DATE = new Date('2026-10-01T00:00:00Z');

const createdOrganizationIds: string[] = [];

/** Removes this suite's carrier (versions cascade; orders' snapshot pointers clear) and its commission rules. */
async function deleteSuiteReferenceRows(): Promise<void> {
  await prisma.shippingCarrier.deleteMany({
    where: { platform: Platform.TRENDYOL, code: SNAPSHOT_CARRIER.code },
  });
  await prisma.marketplaceCommissionRate.deleteMany({
    where: { platform: Platform.TRENDYOL, categoryId: { in: SUITE_CATEGORY_IDS } },
  });
}

/** The category rule and the category+brand rule of this suite's category. */
async function seedSuiteCommissionRules(): Promise<void> {
  const common = {
    platform: Platform.TRENDYOL,
    categoryId: TEST_CATEGORY_ID,
    categoryName: 'Recompute snapshot test category',
    parentCategoryName: null,
    paymentTermDays: 60,
    segmentOverrides: {},
    fetchedAt: new Date(),
    sourceScreen: 'CategoryCommissionPaymentTerms',
  };
  await prisma.marketplaceCommissionRate.createMany({
    data: [
      {
        ...common,
        ruleKind: CommissionRuleKind.CATEGORY,
        brandId: null,
        brandName: null,
        baseRate: CATEGORY_RATE,
      },
      {
        ...common,
        ruleKind: CommissionRuleKind.CATEGORY_BRAND,
        brandId: TEST_BRAND_ID,
        brandName: 'Recompute snapshot test brand',
        baseRate: CATEGORY_BRAND_RATE,
      },
    ],
  });
}

/** Upserts this suite's carrier with its mapping list and distinct desi prices. */
function upsertSnapshotCarrier(orderCargoNames: readonly string[]): Promise<string> {
  return upsertCarrierWithTariffs({
    code: SNAPSHOT_CARRIER.code,
    externalId: SNAPSHOT_CARRIER.externalId,
    orderCargoNames,
    desiRows: SNAPSHOT_DESI_ROWS,
    baremRows: [],
  });
}

/**
 * The melontik parcel priced only by values this suite can change: the order uses
 * this suite's carrier, both order rates are cleared, item A's variant carries a
 * synced rate (15) and item B falls to this suite's category rule.
 */
async function seedSnapshotParcel(): Promise<MelontikParcel> {
  await upsertSnapshotCarrier([SNAPSHOT_CARRIER.orderCargoName]);
  const parcel = await seedMelontikParcel();
  createdOrganizationIds.push(parcel.organizationId);
  await prisma.order.update({
    where: { id: parcel.orderId },
    data: { cargoProviderName: SNAPSHOT_CARRIER.orderCargoName },
  });
  await prisma.orderItem.updateMany({
    where: { organizationId: parcel.organizationId, orderId: parcel.orderId },
    data: { orderCommissionRatePct: null },
  });
  await prisma.product.updateMany({
    where: { organizationId: parcel.organizationId, storeId: parcel.storeId },
    data: { categoryId: TEST_CATEGORY_ID, brandId: TEST_BRAND_ID },
  });
  await prisma.productVariant.update({
    where: { id: parcel.variantA },
    data: { syncedCommissionRate: '15.00' },
  });
  return parcel;
}

/** Runs one recompute in its own transaction, as the queue drain does. */
function recompute(parcel: MelontikParcel): Promise<RecomputeParcelResult> {
  return prisma.$transaction(
    (tx) =>
      recomputeParcelProfit(tx, {
        organizationId: parcel.organizationId,
        orderId: parcel.orderId,
      }),
    { maxWait: 15000, timeout: 30000 },
  );
}

/** Both stored statement views of the order: status, net profit and content hash. */
function readStatements(orderId: string) {
  return prisma.orderProfitStatement.findMany({
    where: { orderId },
    orderBy: { view: 'asc' },
    select: { view: true, status: true, netProfit: true, contentHash: true },
  });
}

/** Computes an order on the read-only path (no capture, nothing written). */
function computeReadOnly(organizationId: string, orderId: string): Promise<ComputedParcelProfit> {
  return prisma.$transaction((tx) => computeParcelProfit(tx, { organizationId, orderId }));
}

/** The content hash the writer would store for a computed order. */
function contentHashOf(computed: ComputedParcelProfit): string {
  return profitContentHash({
    engineVersion: PROFIT_ENGINE_VERSION,
    settings: computed.settings,
    lines: computed.lines,
    allocations: computed.allocations,
    statements: [computed.estimate, computed.bestKnown],
  });
}

/** The computed line of the given type (and item, for an item-level line), if any. */
function findLine(
  computed: ComputedParcelProfit,
  type: ProfitLineType,
  orderItemId: string | null = null,
): ProfitLine | undefined {
  return computed.lines.find((line) => line.type === type && line.orderItemId === orderItemId);
}

/**
 * A second order in the parcel's store with the same items (same variants, amounts
 * and order rates) and the same cargo name. It is never recomputed, so it has no
 * capture and the engine prices it with the live values: the control for the
 * captured order.
 */
async function seedUncapturedTwin(parcel: MelontikParcel): Promise<string> {
  const source = await prisma.order.findFirstOrThrow({
    where: { id: parcel.orderId, organizationId: parcel.organizationId },
    include: { items: true },
  });
  const twin = await prisma.order.create({
    data: {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platformOrderId: `twin-${randomUUID().slice(0, 8)}`,
      orderDate: source.orderDate,
      status: source.status,
      isExportSale: source.isExportSale,
      fastDelivery: source.fastDelivery,
      fastDeliveryType: source.fastDeliveryType,
      usesSellerCargoAgreement: source.usesSellerCargoAgreement,
      cargoProviderName: source.cargoProviderName,
    },
  });
  for (const item of source.items) {
    await prisma.orderItem.create({
      data: {
        orderId: twin.id,
        organizationId: parcel.organizationId,
        productVariantId: item.productVariantId,
        quantity: item.quantity,
        barcode: item.barcode,
        lineListGross: item.lineListGross,
        lineSaleGross: item.lineSaleGross,
        lineSellerDiscountGross: item.lineSellerDiscountGross,
        saleVatRate: item.saleVatRate,
        orderCommissionRatePct: item.orderCommissionRatePct,
      },
    });
  }
  return twin.id;
}

/**
 * Adds a third item to the parcel's order after its capture: a new variant in this
 * suite's category and brand (no synced rate, desi 1, a cost in force at the order
 * date) and an order line without its own rate. Returns the new order item id.
 */
async function addUncapturedItem(parcel: MelontikParcel): Promise<string> {
  const product = await prisma.product.create({
    data: {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platformContentId: 100_003n,
      productMainId: 'main-bc-c',
      title: 'Melontik bc-c',
      categoryId: TEST_CATEGORY_ID,
      brandId: TEST_BRAND_ID,
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      productId: product.id,
      platformVariantId: 200_003n,
      barcode: 'bc-c',
      stockCode: 'sku-bc-c',
      salePrice: '200.00',
      listPrice: '200.00',
      syncedDimensionalWeight: '1',
      isDigital: false,
    },
  });
  await attachCostProfile({
    organizationId: parcel.organizationId,
    storeId: parcel.storeId,
    productVariantId: variant.id,
    amountGross: '80.00',
    vatRate: '10',
    effectiveFrom: BEFORE_ORDER_DATE,
  });
  const item = await prisma.orderItem.create({
    data: {
      orderId: parcel.orderId,
      organizationId: parcel.organizationId,
      productVariantId: variant.id,
      quantity: 1,
      barcode: 'bc-c',
      lineListGross: '200.00',
      lineSaleGross: '200.00',
      lineSellerDiscountGross: '0.00',
      saleVatRate: '10',
      orderCommissionRatePct: null,
    },
  });
  return item.id;
}

/** One change of a live product or seller input. */
type LiveInputChange = (parcel: MelontikParcel) => Promise<void>;

/**
 * Every live product and seller input the parcel is priced with, each as one change.
 * On its own, each one moves the parcel's profit when the engine reads live values.
 */
const LIVE_INPUT_CHANGES = {
  // Product card: the seller corrects item A's desi 1 -> 3 (parcel desi 2 -> 4).
  desiCorrection: async (parcel) => {
    await prisma.productVariant.update({
      where: { id: parcel.variantA },
      data: { dimensionalWeightOverride: '3.00' },
    });
  },
  // Product sync: item A's synced commission rate 15 -> 25.
  syncedRate: async (parcel) => {
    await prisma.productVariant.update({
      where: { id: parcel.variantA },
      data: { syncedCommissionRate: '25.00' },
    });
  },
  // Shared reference: this suite's category rules (item B's rate) change.
  categoryRule: async () => {
    await prisma.marketplaceCommissionRate.updateMany({
      where: {
        platform: Platform.TRENDYOL,
        categoryId: TEST_CATEGORY_ID,
        ruleKind: CommissionRuleKind.CATEGORY,
      },
      data: { baseRate: '30.00' },
    });
    await prisma.marketplaceCommissionRate.updateMany({
      where: {
        platform: Platform.TRENDYOL,
        categoryId: TEST_CATEGORY_ID,
        ruleKind: CommissionRuleKind.CATEGORY_BRAND,
      },
      data: { baseRate: '28.00' },
    });
  },
  // Seller cost: item A's profile becomes a packaging cost. Only the profile row
  // changes; the pinned version keeps the type it was written with. Listed before
  // costLink, so that the combined change still hits the pinned profile.
  costProfileType: async (parcel) => {
    const linkA = await prisma.productVariantCostProfile.findFirstOrThrow({
      where: { organizationId: parcel.organizationId, productVariantId: parcel.variantA },
      select: { profileId: true },
    });
    await prisma.costProfile.update({
      where: { id: linkA.profileId, organizationId: parcel.organizationId },
      data: { type: CostProfileType.PACKAGING },
    });
  },
  // Seller cost: item A's link is replaced by another profile.
  costLink: async (parcel) => {
    await prisma.productVariantCostProfile.deleteMany({
      where: { organizationId: parcel.organizationId, productVariantId: parcel.variantA },
    });
    await attachCostProfile({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      productVariantId: parcel.variantA,
      amountGross: '300.00',
      vatRate: '10',
      effectiveFrom: BEFORE_ORDER_DATE,
    });
  },
  // Seller cost: item B's profile gets a new amount as a new version in force at the
  // order date (versions are never edited in place).
  costAmount: async (parcel) => {
    const linkB = await prisma.productVariantCostProfile.findFirstOrThrow({
      where: { organizationId: parcel.organizationId, productVariantId: parcel.variantB },
      select: { profileId: true },
    });
    await prisma.costProfile.update({
      where: { id: linkB.profileId },
      data: { amountGross: '199.00' },
    });
    await prisma.costProfileVersion.create({
      data: {
        profileId: linkB.profileId,
        organizationId: parcel.organizationId,
        version: 2,
        name: 'COGS bc-b',
        type: CostProfileType.COGS,
        amountGross: '199.00',
        vatRate: '10',
        changedFields: ['amountGross'],
        effectiveFrom: BEFORE_ORDER_DATE,
      },
    });
  },
  // Product card: item A becomes digital, so it leaves the parcel desi (2 -> 1).
  digitalFlag: async (parcel) => {
    await prisma.productVariant.update({
      where: { id: parcel.variantA },
      data: { isDigital: true },
    });
  },
  // Product card: the products move to another category with its own rule, so item B
  // resolves 22 from that rule instead of 16.5.
  productCategory: async (parcel) => {
    await prisma.marketplaceCommissionRate.create({
      data: {
        platform: Platform.TRENDYOL,
        ruleKind: CommissionRuleKind.CATEGORY,
        categoryId: TEST_OTHER_CATEGORY_ID,
        brandId: null,
        categoryName: 'Recompute snapshot other category',
        parentCategoryName: null,
        brandName: null,
        baseRate: '22.00',
        paymentTermDays: 60,
        segmentOverrides: {},
        fetchedAt: new Date(),
        sourceScreen: 'CategoryCommissionPaymentTerms',
      },
    });
    await prisma.product.updateMany({
      where: { organizationId: parcel.organizationId, storeId: parcel.storeId },
      data: { categoryId: TEST_OTHER_CATEGORY_ID },
    });
  },
  // Product card: the products move to another brand, so item B falls from the
  // category+brand rule (16.5) to the category rule (18).
  productBrand: async (parcel) => {
    await prisma.product.updateMany({
      where: { organizationId: parcel.organizationId, storeId: parcel.storeId },
      data: { brandId: TEST_OTHER_BRAND_ID },
    });
  },
  // Seller setting: the store moves to its own shipping contract.
  storeTariffSource: async (parcel) => {
    await prisma.store.update({
      where: { id: parcel.storeId },
      data: { shippingTariffSource: ShippingTariffSource.OWN_CONTRACT },
    });
  },
  // Carrier mapping: the order's cargo name is no longer on the carrier's list.
  carrierMapping: async () => {
    await upsertSnapshotCarrier([]);
  },
} satisfies Readonly<Record<string, LiveInputChange>>;

/** LIVE_INPUT_CHANGES as (name, change) pairs, in declaration order. */
const LIVE_INPUT_CHANGE_LIST: readonly (readonly [string, LiveInputChange])[] =
  Object.entries(LIVE_INPUT_CHANGES);

/** Applies every change of LIVE_INPUT_CHANGES, one after the other. */
async function changeLiveInputs(parcel: MelontikParcel): Promise<void> {
  for (const [, change] of LIVE_INPUT_CHANGE_LIST) {
    await change(parcel);
  }
}

describe('recomputeParcelProfit with the order profit snapshot', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await deleteSuiteReferenceRows();
    await seedSuiteCommissionRules();
  });

  afterAll(async () => {
    await deleteSuiteReferenceRows();
    await prisma.organization.deleteMany({ where: { id: { in: createdOrganizationIds } } });
  });

  it('a stored order keeps its profit when product and seller inputs change after intake', async () => {
    const parcel = await seedSnapshotParcel();

    const first = await recompute(parcel);
    expect(first.changed).toBe(true);
    expect(first.bestKnown.status).toBe(ProfitStatus.ESTIMATED);
    const before = await readStatements(parcel.orderId);
    expect(before.map((row) => row.view)).toEqual([
      ProfitStatementView.ESTIMATE,
      ProfitStatementView.BEST_KNOWN,
    ]);
    expect(before.every((row) => row.netProfit !== null)).toBe(true);

    await changeLiveInputs(parcel);

    const second = await recompute(parcel);
    expect(second.changed).toBe(false);
    const after = await readStatements(parcel.orderId);
    expect(after).toEqual(before);
  });

  // The control for the test above, one change at a time, each on a fresh parcel: the
  // change moves an uncaptured order priced live, while the captured order keeps its
  // stored profit.
  it.each(LIVE_INPUT_CHANGE_LIST)(
    'the %s change moves an uncaptured order but not a captured one',
    async (_name, change) => {
      const parcel = await seedSnapshotParcel();
      const twinOrderId = await seedUncapturedTwin(parcel);
      await recompute(parcel);
      const capturedBefore = await readStatements(parcel.orderId);
      const twinBefore = contentHashOf(await computeReadOnly(parcel.organizationId, twinOrderId));

      await change(parcel);

      const twinAfter = contentHashOf(await computeReadOnly(parcel.organizationId, twinOrderId));
      expect(twinAfter).not.toBe(twinBefore);
      // The read-only path captured nothing: the twin is still priced live.
      const twin = await prisma.order.findFirstOrThrow({
        where: { id: twinOrderId, organizationId: parcel.organizationId },
        select: { profitSnapshotAt: true },
      });
      expect(twin.profitSnapshotAt).toBeNull();

      const second = await recompute(parcel);
      expect(second.changed).toBe(false);
      expect(await readStatements(parcel.orderId)).toEqual(capturedBefore);
    },
  );

  it('the read path and the persisted path agree for a captured order', async () => {
    const parcel = await seedSnapshotParcel();
    await recompute(parcel);
    const stored = await readStatements(parcel.orderId);

    // The read path writes nothing, so it would show live values if it ignored the
    // capture; change them first.
    await changeLiveInputs(parcel);

    const computed = await prisma.$transaction((tx) =>
      computeParcelProfit(tx, {
        organizationId: parcel.organizationId,
        orderId: parcel.orderId,
      }),
    );
    const storedByView = new Map(stored.map((row) => [row.view, row]));
    const views = [
      { view: ProfitStatementView.ESTIMATE, statement: computed.estimate },
      { view: ProfitStatementView.BEST_KNOWN, statement: computed.bestKnown },
    ];
    for (const { view, statement } of views) {
      const row = storedByView.get(view);
      expect(row?.status).toBe(statement.status);
      // Both sides are decimal.js values; toString() gives the same normalized text
      // for equal amounts. Null on both sides would hide a mismatch, so rule it out.
      expect(row?.netProfit).not.toBeNull();
      expect(statement.netProfit).not.toBeNull();
      expect(row?.netProfit?.toString()).toBe(statement.netProfit?.toString());
    }
  });

  it('an uncaptured order is captured on its first recompute', async () => {
    const parcel = await seedSnapshotParcel();
    const orderBefore = await prisma.order.findUniqueOrThrow({
      where: { id: parcel.orderId },
      select: { profitSnapshotAt: true },
    });
    expect(orderBefore.profitSnapshotAt).toBeNull();
    const itemsBefore = await prisma.orderItem.findMany({
      where: { orderId: parcel.orderId },
      select: { profitSnapshotAt: true },
    });
    expect(itemsBefore).toHaveLength(2);
    expect(itemsBefore.every((item) => item.profitSnapshotAt === null)).toBe(true);

    await recompute(parcel);

    const orderAfter = await prisma.order.findUniqueOrThrow({
      where: { id: parcel.orderId },
      select: { profitSnapshotAt: true, snapshotCarrierId: true },
    });
    expect(orderAfter.profitSnapshotAt).not.toBeNull();
    expect(orderAfter.snapshotCarrierId).not.toBeNull();
    const itemsAfter = await prisma.orderItem.findMany({
      where: { orderId: parcel.orderId },
      select: { profitSnapshotAt: true, snapshotCostProfileVersionIds: true },
    });
    expect(itemsAfter).toHaveLength(2);
    expect(itemsAfter.every((item) => item.profitSnapshotAt !== null)).toBe(true);
    expect(itemsAfter.every((item) => item.snapshotCostProfileVersionIds.length === 1)).toBe(true);
  });

  it('a captured order reads a later-added uncaptured item live', async () => {
    // Item B was captured with this suite's category rules (18 / 16.5 -> 16.5).
    const parcel = await seedSnapshotParcel();
    await recompute(parcel);

    // A third item joins after the capture, in the same category and brand; then the
    // category rules change (30 / 28).
    const itemC = await addUncapturedItem(parcel);
    await LIVE_INPUT_CHANGES.categoryRule();

    const computed = await computeReadOnly(parcel.organizationId, parcel.orderId);
    // The captured item keeps the rate of its capture moment...
    expect(findLine(computed, ProfitLineType.COMMISSION, parcel.itemB)?.inputs).toMatchObject({
      ratePct: '16.5',
      rateSource: 'CATEGORY_BRAND',
    });
    // ...while the uncaptured item resolves from the current rule.
    expect(findLine(computed, ProfitLineType.COMMISSION, itemC)?.inputs).toMatchObject({
      ratePct: '28',
      rateSource: 'CATEGORY_BRAND',
    });
    const addedItem = await prisma.orderItem.findFirstOrThrow({
      where: { id: itemC, organizationId: parcel.organizationId },
      select: { profitSnapshotAt: true },
    });
    expect(addedItem.profitSnapshotAt).toBeNull();
  });

  it("a cost linked after the order's business day leaves BEST_KNOWN not computable with MISSING_COST", async () => {
    const parcel = await seedSnapshotParcel();
    // Item A's only profile was archived before the order: no cost in force for it.
    const linkA = await prisma.productVariantCostProfile.findFirstOrThrow({
      where: { organizationId: parcel.organizationId, productVariantId: parcel.variantA },
      select: { profileId: true },
    });
    await prisma.costProfile.update({
      where: { id: linkA.profileId, organizationId: parcel.organizationId },
      data: { archivedAt: BEFORE_ORDER_DATE },
    });
    await prisma.costProfileVersion.create({
      data: {
        profileId: linkA.profileId,
        organizationId: parcel.organizationId,
        version: 2,
        name: 'COGS bc-a',
        type: CostProfileType.COGS,
        amountGross: MELONTIK.items.a.costGross,
        vatRate: MELONTIK.costVatRate,
        changedFields: ['archivedAt'],
        effectiveFrom: BEFORE_ORDER_DATE,
        archivedAt: BEFORE_ORDER_DATE,
      },
    });

    const first = await recompute(parcel);
    expect(first.bestKnown.status).toBe(ProfitStatus.NOT_COMPUTABLE);

    // The seller attaches a new profile now, long after the order's day ended.
    await attachCostProfile({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      productVariantId: parcel.variantA,
      amountGross: MELONTIK.items.a.costGross,
      vatRate: MELONTIK.costVatRate,
      attachedAt: new Date(),
    });

    const second = await recompute(parcel);
    expect(second.bestKnown.status).toBe(ProfitStatus.NOT_COMPUTABLE);
    expect(second.bestKnown.netProfit).toBeNull();
    const computed = await computeReadOnly(parcel.organizationId, parcel.orderId);
    expect(computed.bestKnown.status).toBe(ProfitStatus.NOT_COMPUTABLE);
    expect(computed.bestKnown.issues).toContainEqual(
      expect.objectContaining({ code: ProfitIssueCode.MISSING_COST, orderItemId: parcel.itemA }),
    );
    expect(findLine(computed, ProfitLineType.COST_COGS, parcel.itemA)).toBeUndefined();
  });

  it('a captured carrier that was later deactivated still prices the order', async () => {
    const parcel = await seedSnapshotParcel();
    const twinOrderId = await seedUncapturedTwin(parcel);
    await recompute(parcel);
    const stored = await readStatements(parcel.orderId);

    await prisma.shippingCarrier.update({
      where: { platform_code: { platform: Platform.TRENDYOL, code: SNAPSHOT_CARRIER.code } },
      data: { active: false },
    });

    // The captured order still prices its parcel desi (2) with the carrier's tariff.
    const computed = await computeReadOnly(parcel.organizationId, parcel.orderId);
    expect(findLine(computed, ProfitLineType.SHIPPING)?.inputs).toMatchObject({
      tariffKind: 'DESI',
      carrierCode: SNAPSHOT_CARRIER.code,
      desi: '2',
    });
    const storedBestKnown = stored.find((row) => row.view === ProfitStatementView.BEST_KNOWN);
    expect(storedBestKnown?.netProfit).not.toBeNull();
    expect(computed.bestKnown.netProfit?.toString()).toBe(storedBestKnown?.netProfit?.toString());
    const second = await recompute(parcel);
    expect(second.changed).toBe(false);

    // Control: an uncaptured order no longer recognizes the inactive carrier, so it gets
    // no shipping line and a blocking CARRIER_NOT_RECOGNIZED issue.
    const twin = await computeReadOnly(parcel.organizationId, twinOrderId);
    expect(findLine(twin, ProfitLineType.SHIPPING)).toBeUndefined();
    expect(twin.bestKnown.issues.map((issue) => issue.code)).toContain(
      ProfitIssueCode.CARRIER_NOT_RECOGNIZED,
    );
  });
});
