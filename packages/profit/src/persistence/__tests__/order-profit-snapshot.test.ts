/**
 * Integration tests for captureOrderProfitSnapshot (plan PR-2, Gorev 2): the order's
 * undated product and seller inputs are copied once, afterwards only missing parts
 * are filled (commission inputs none of which gives a rate, an empty cost list), and
 * a known value is never overwritten with a live one. The desi is never filled: a
 * captured desi (0 included) is known, and an item captured without one stays empty
 * (plan PR-2c decision 9). The
 * events that change a filled value are the order's own cargo name changing, an
 * item's variant changing, and the cost-window rule: the cost list follows the cost
 * links until the order's business day ends.
 *
 * The suite never truncates: shared reference tables (carriers, commission rules) are
 * touched only through this suite's own TEST_-prefixed carriers and its own category
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
  ProfitExclusionReason,
  ShippingTariffSource,
  SnapshotDesiSource,
} from '@pazarsync/db/enums';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  captureOrderProfitSnapshot,
  type OrderProfitSnapshotOutcome,
} from '../order-profit-snapshot';
import {
  attachCostProfile,
  ensureDbReachable,
  MELONTIK,
  type MelontikParcel,
  type SeedMelontikOptions,
  seedMelontikParcel,
  upsertCarrierWithTariffs,
} from './helpers/melontik-parcel';

/** This suite's own categories and brands; no seeded commission rule uses them. */
const TEST_CATEGORY_ID = 9_990_701n;
const TEST_BRAND_ID = 9_990_702n;
const TEST_OTHER_BRAND_ID = 9_990_703n;
const TEST_OTHER_CATEGORY_ID = 9_990_704n;
const SUITE_CATEGORY_IDS = [TEST_CATEGORY_ID, TEST_OTHER_CATEGORY_ID];

/** This suite's own carriers (TEST_-prefixed codes, unused external ids). */
const RENAMED_CARRIER = {
  code: 'TEST_SNAPSHOT_RENAMED',
  externalId: 990_201,
  displayName: 'Test Snapshot Renamed Kargo',
} as const;
const GAP_CARRIER = {
  code: 'TEST_SNAPSHOT_GAP',
  externalId: 990_202,
  displayName: 'Test Snapshot Gap',
} as const;
const OTHER_CARRIER = {
  code: 'TEST_SNAPSHOT_OTHER',
  externalId: 990_203,
  displayName: 'Test Snapshot Other',
} as const;
const SUITE_CARRIER_CODES = [RENAMED_CARRIER.code, GAP_CARRIER.code, OTHER_CARRIER.code];

/** The cargo name no carrier claims until the gap test maps it. */
const GAP_CARGO_NAME = 'Test Snapshot Gap Kargo Marketplace';
/** A cargo name no carrier ever claims. */
const UNKNOWN_CARGO_NAME = 'Test Snapshot Unknown Kargo';

const CATEGORY_RATE = '18.00';
const CATEGORY_BRAND_RATE = '16.50';

const ORDER_SNAPSHOT_SELECT = {
  snapshotCarrierId: true,
  snapshotCargoProviderName: true,
  snapshotShippingTariffSource: true,
  snapshotIncludeStopaj: true,
  snapshotIncludeNegativeNetVat: true,
  profitSnapshotAt: true,
} as const;

const ITEM_SNAPSHOT_SELECT = {
  snapshotProductVariantId: true,
  snapshotUnitDesi: true,
  snapshotDesiSource: true,
  snapshotIsDigital: true,
  snapshotCategoryId: true,
  snapshotBrandId: true,
  snapshotSyncedCommissionRatePct: true,
  snapshotCategoryRatePct: true,
  snapshotCategoryBrandRatePct: true,
  snapshotCostProfileVersionIds: true,
  profitSnapshotAt: true,
} as const;

const createdOrganizationIds: string[] = [];

/** Removes this suite's carriers (versions cascade; orders' snapshot pointers clear) and its commission rules. */
async function deleteSuiteReferenceRows(): Promise<void> {
  await prisma.shippingCarrier.deleteMany({
    where: { platform: Platform.TRENDYOL, code: { in: SUITE_CARRIER_CODES } },
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
    categoryName: 'Snapshot test category',
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
        brandName: 'Snapshot test brand',
        baseRate: CATEGORY_BRAND_RATE,
      },
    ],
  });
}

/**
 * The melontik parcel, moved to this suite's category and brand, with item A's
 * variant carrying a seller desi correction (3.50) and a synced commission rate (15).
 */
async function seedSnapshotParcel(opts: SeedMelontikOptions = {}): Promise<MelontikParcel> {
  const parcel = await seedMelontikParcel(opts);
  createdOrganizationIds.push(parcel.organizationId);
  await prisma.product.updateMany({
    where: { organizationId: parcel.organizationId, storeId: parcel.storeId },
    data: { categoryId: TEST_CATEGORY_ID, brandId: TEST_BRAND_ID },
  });
  await prisma.productVariant.update({
    where: { id: parcel.variantA },
    data: { dimensionalWeightOverride: '3.50', syncedCommissionRate: '15.00' },
  });
  return parcel;
}

/** Runs the capture in its own transaction, as the recompute and the order upsert do. */
function capture(parcel: MelontikParcel): Promise<OrderProfitSnapshotOutcome> {
  return prisma.$transaction((tx) =>
    captureOrderProfitSnapshot(tx, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    }),
  );
}

function readOrderSnapshot(orderId: string) {
  return prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: ORDER_SNAPSHOT_SELECT });
}

function readItemSnapshot(orderItemId: string) {
  return prisma.orderItem.findUniqueOrThrow({
    where: { id: orderItemId },
    select: ITEM_SNAPSHOT_SELECT,
  });
}

/** Every cost profile version id linked to the variant today, sorted. */
async function linkedCostVersionIds(
  organizationId: string,
  productVariantId: string,
): Promise<string[]> {
  const rows = await prisma.costProfileVersion.findMany({
    where: { organizationId, profile: { variantLinks: { some: { productVariantId } } } },
    select: { id: true },
  });
  return rows.map((row) => row.id).sort();
}

/** A stored cost list in a stable order, for order-independent comparison. */
function sorted(ids: readonly string[]): string[] {
  return [...ids].sort();
}

/** A cost version start before the melontik order date (2026-10-28): in force at it. */
const BEFORE_ORDER_DATE = new Date('2026-10-01T00:00:00Z');
/** A cost version start after the melontik order date: not yet in force at it. */
const AFTER_ORDER_DATE = new Date('2026-11-10T00:00:00Z');

/** One version of a test cost profile; `archived` marks the profile archived from this version on. */
interface TestCostVersionSpec {
  readonly id: string;
  readonly effectiveFrom: Date;
  readonly archived: boolean;
}

/**
 * Links a new packaging profile to the variant with the given versions, numbered
 * 1, 2, ... in the given order. The caller picks the version ids so it can assert
 * on them and steer their sort order.
 */
async function attachCostProfileVersions(
  parcel: MelontikParcel,
  productVariantId: string,
  versions: readonly TestCostVersionSpec[],
): Promise<void> {
  const profile = await prisma.costProfile.create({
    data: {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      name: `Packaging ${randomUUID().slice(0, 8)}`,
      type: CostProfileType.PACKAGING,
      amountGross: '30.00',
      vatRate: '20',
    },
  });
  for (const [index, spec] of versions.entries()) {
    await prisma.costProfileVersion.create({
      data: {
        id: spec.id,
        profileId: profile.id,
        organizationId: parcel.organizationId,
        version: index + 1,
        name: profile.name,
        type: CostProfileType.PACKAGING,
        amountGross: '30.00',
        vatRate: '20',
        changedFields: [],
        effectiveFrom: spec.effectiveFrom,
        archivedAt: spec.archived ? spec.effectiveFrom : null,
      },
    });
  }
  await prisma.productVariantCostProfile.create({
    data: { organizationId: parcel.organizationId, productVariantId, profileId: profile.id },
  });
}

/** A random version id that sorts before any random one (steers the sort-order assertion). */
function lowSortingId(): string {
  return `00000000-${randomUUID().slice(9)}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Moves the parcel's order to another order date (time-relative tests pass "now"-based dates). */
async function setOrderDate(parcel: MelontikParcel, orderDate: Date): Promise<void> {
  await prisma.order.update({
    where: { id: parcel.orderId, organizationId: parcel.organizationId },
    data: { orderDate },
  });
}

/** The product a variant belongs to. */
async function productIdOf(productVariantId: string): Promise<string> {
  const variant = await prisma.productVariant.findUniqueOrThrow({
    where: { id: productVariantId },
    select: { productId: true },
  });
  return variant.productId;
}

describe('captureOrderProfitSnapshot', () => {
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

  it('captures carrier, tariff source and every item input on the first call', async () => {
    // The store says "no stopaj"; the order already carries a filled negative-VAT flag
    // that differs from the store's, which must survive.
    const parcel = await seedSnapshotParcel({
      storeProfitSettings: { includeStopaj: false, includeNegativeNetVat: true },
      snapshotIncludeNegativeNetVat: false,
    });
    const costIdsA = await linkedCostVersionIds(parcel.organizationId, parcel.variantA);
    const costIdsB = await linkedCostVersionIds(parcel.organizationId, parcel.variantB);

    // Under another organization the order is not found: nothing is written.
    await expect(capture({ ...parcel, organizationId: randomUUID() })).resolves.toEqual({
      orderWritten: false,
      itemsWritten: 0,
    });
    expect((await readOrderSnapshot(parcel.orderId)).profitSnapshotAt).toBeNull();
    expect((await readItemSnapshot(parcel.itemA)).profitSnapshotAt).toBeNull();

    await expect(capture(parcel)).resolves.toEqual({ orderWritten: true, itemsWritten: 2 });

    const order = await readOrderSnapshot(parcel.orderId);
    expect(order.snapshotCarrierId).toBe(parcel.carrierId);
    expect(order.snapshotCargoProviderName).toBe(MELONTIK.cargoProviderName);
    expect(order.snapshotShippingTariffSource).toBe(ShippingTariffSource.TRENDYOL_CONTRACT);
    expect(order.snapshotIncludeStopaj).toBe(false);
    expect(order.snapshotIncludeNegativeNetVat).toBe(false);
    expect(order.profitSnapshotAt).not.toBeNull();

    const itemA = await readItemSnapshot(parcel.itemA);
    expect(itemA.snapshotProductVariantId).toBe(parcel.variantA);
    expect(itemA.snapshotUnitDesi?.toString()).toBe('3.5');
    expect(itemA.snapshotDesiSource).toBe(SnapshotDesiSource.OVERRIDE);
    expect(itemA.snapshotIsDigital).toBe(false);
    expect(itemA.snapshotCategoryId).toBe(TEST_CATEGORY_ID);
    expect(itemA.snapshotBrandId).toBe(TEST_BRAND_ID);
    expect(itemA.snapshotSyncedCommissionRatePct?.toString()).toBe('15');
    expect(itemA.snapshotCategoryRatePct?.toString()).toBe('18');
    expect(itemA.snapshotCategoryBrandRatePct?.toString()).toBe('16.5');
    expect(sorted(itemA.snapshotCostProfileVersionIds)).toEqual(costIdsA);
    expect(costIdsA).toHaveLength(1);
    expect(itemA.profitSnapshotAt).not.toBeNull();

    const itemB = await readItemSnapshot(parcel.itemB);
    expect(itemB.snapshotProductVariantId).toBe(parcel.variantB);
    expect(itemB.snapshotUnitDesi?.toString()).toBe('1');
    expect(itemB.snapshotDesiSource).toBe(SnapshotDesiSource.SYNCED);
    expect(itemB.snapshotIsDigital).toBe(false);
    expect(itemB.snapshotSyncedCommissionRatePct).toBeNull();
    expect(itemB.snapshotCategoryRatePct?.toString()).toBe('18');
    expect(itemB.snapshotCategoryBrandRatePct?.toString()).toBe('16.5');
    expect(sorted(itemB.snapshotCostProfileVersionIds)).toEqual(costIdsB);
    expect(costIdsB).toHaveLength(1);
    expect(itemB.profitSnapshotAt).not.toBeNull();
  });

  it('a second call writes nothing when nothing is missing', async () => {
    const parcel = await seedSnapshotParcel();
    await capture(parcel);
    const orderBefore = await readOrderSnapshot(parcel.orderId);
    const itemABefore = await readItemSnapshot(parcel.itemA);
    const itemBBefore = await readItemSnapshot(parcel.itemB);

    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 0 });

    expect(await readOrderSnapshot(parcel.orderId)).toEqual(orderBefore);
    expect(await readItemSnapshot(parcel.itemA)).toEqual(itemABefore);
    expect(await readItemSnapshot(parcel.itemB)).toEqual(itemBBefore);
  });

  it('keeps captured values when the variant desi, synced rate, category rule, cost link and store tariff source change', async () => {
    const parcel = await seedSnapshotParcel();
    await capture(parcel);
    const orderBefore = await readOrderSnapshot(parcel.orderId);
    const itemABefore = await readItemSnapshot(parcel.itemA);
    const itemBBefore = await readItemSnapshot(parcel.itemB);

    // Product card: desi correction, synced desi, synced rate, digital flag, and the
    // product moves to another category (which has its own rule) and brand.
    await prisma.productVariant.update({
      where: { id: parcel.variantA },
      data: { dimensionalWeightOverride: '7.00', syncedCommissionRate: '12.00', isDigital: true },
    });
    await prisma.productVariant.update({
      where: { id: parcel.variantB },
      data: { syncedDimensionalWeight: '4.00' },
    });
    await prisma.marketplaceCommissionRate.create({
      data: {
        platform: Platform.TRENDYOL,
        ruleKind: CommissionRuleKind.CATEGORY,
        categoryId: TEST_OTHER_CATEGORY_ID,
        brandId: null,
        categoryName: 'Snapshot test other category',
        parentCategoryName: null,
        brandName: null,
        baseRate: '30.00',
        paymentTermDays: 60,
        segmentOverrides: {},
        fetchedAt: new Date(),
        sourceScreen: 'CategoryCommissionPaymentTerms',
      },
    });
    await prisma.product.updateMany({
      where: { organizationId: parcel.organizationId, storeId: parcel.storeId },
      data: { categoryId: TEST_OTHER_CATEGORY_ID, brandId: TEST_OTHER_BRAND_ID },
    });
    // Shared reference: the captured category's rules change.
    await prisma.marketplaceCommissionRate.updateMany({
      where: { platform: Platform.TRENDYOL, categoryId: TEST_CATEGORY_ID },
      data: { baseRate: '25.00' },
    });
    // Seller input: item A's cost link is replaced, the store's settings change.
    await prisma.productVariantCostProfile.deleteMany({
      where: { organizationId: parcel.organizationId, productVariantId: parcel.variantA },
    });
    await attachCostProfile({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      productVariantId: parcel.variantA,
      amountGross: '999.00',
      vatRate: '20',
    });
    await prisma.store.update({
      where: { id: parcel.storeId },
      data: {
        shippingTariffSource: ShippingTariffSource.OWN_CONTRACT,
        profitSettings: { includeStopaj: false, includeNegativeNetVat: false },
      },
    });

    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 0 });

    expect(await readOrderSnapshot(parcel.orderId)).toEqual(orderBefore);
    const itemAAfter = await readItemSnapshot(parcel.itemA);
    expect(itemAAfter).toEqual(itemABefore);
    expect(itemAAfter.snapshotCategoryId).toBe(TEST_CATEGORY_ID);
    expect(await readItemSnapshot(parcel.itemB)).toEqual(itemBBefore);
  });

  it("re-recognises the carrier when the order's own cargo name changes", async () => {
    const renamedCarrierId = await upsertCarrierWithTariffs({
      ...RENAMED_CARRIER,
      desiRows: [],
      baremRows: [],
    });
    const parcel = await seedSnapshotParcel();
    await capture(parcel);
    const before = await readOrderSnapshot(parcel.orderId);
    expect(before.snapshotCarrierId).toBe(parcel.carrierId);

    // Trendyol moves the order to another carrier: the order's own data changed.
    await prisma.order.update({
      where: { id: parcel.orderId },
      data: { cargoProviderName: RENAMED_CARRIER.displayName },
    });
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: true, itemsWritten: 0 });
    expect(await readOrderSnapshot(parcel.orderId)).toEqual({
      ...before,
      snapshotCarrierId: renamedCarrierId,
      snapshotCargoProviderName: RENAMED_CARRIER.displayName,
    });

    // A name no carrier claims: the order is no longer on a recognised carrier.
    await prisma.order.update({
      where: { id: parcel.orderId },
      data: { cargoProviderName: UNKNOWN_CARGO_NAME },
    });
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: true, itemsWritten: 0 });
    expect(await readOrderSnapshot(parcel.orderId)).toEqual({
      ...before,
      snapshotCarrierId: null,
      snapshotCargoProviderName: UNKNOWN_CARGO_NAME,
    });
  });

  it('fills a carrier that was not recognised once its name becomes known, and leaves a recognised one alone after a mapping edit', async () => {
    const parcel = await seedSnapshotParcel();
    await prisma.order.update({
      where: { id: parcel.orderId },
      data: { cargoProviderName: GAP_CARGO_NAME },
    });
    await capture(parcel);
    const before = await readOrderSnapshot(parcel.orderId);
    expect(before.snapshotCarrierId).toBeNull();
    expect(before.snapshotCargoProviderName).toBe(GAP_CARGO_NAME);

    // The name becomes known: a carrier now lists it in orderCargoNames (gap fill).
    const gapCarrierId = await upsertCarrierWithTariffs({
      ...GAP_CARRIER,
      orderCargoNames: [GAP_CARGO_NAME],
      desiRows: [],
      baremRows: [],
    });
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: true, itemsWritten: 0 });
    expect(await readOrderSnapshot(parcel.orderId)).toEqual({
      ...before,
      snapshotCarrierId: gapCarrierId,
    });

    // A mapping edit moves the name to another carrier: the recognised one stays.
    await upsertCarrierWithTariffs({
      ...GAP_CARRIER,
      orderCargoNames: [],
      desiRows: [],
      baremRows: [],
    });
    await upsertCarrierWithTariffs({
      ...OTHER_CARRIER,
      orderCargoNames: [GAP_CARGO_NAME],
      desiRows: [],
      baremRows: [],
    });
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 0 });
    expect((await readOrderSnapshot(parcel.orderId)).snapshotCarrierId).toBe(gapCarrierId);
  });

  it('captures an item whose variant is linked after intake, once', async () => {
    const parcel = await seedSnapshotParcel();
    // Item B arrives with a barcode not yet matched to a variant.
    await prisma.orderItem.update({
      where: { id: parcel.itemB },
      data: { productVariantId: null },
    });

    await expect(capture(parcel)).resolves.toEqual({ orderWritten: true, itemsWritten: 2 });
    const unmatched = await readItemSnapshot(parcel.itemB);
    expect(unmatched).toEqual({
      snapshotProductVariantId: null,
      snapshotUnitDesi: null,
      snapshotDesiSource: null,
      snapshotIsDigital: null,
      snapshotCategoryId: null,
      snapshotBrandId: null,
      snapshotSyncedCommissionRatePct: null,
      snapshotCategoryRatePct: null,
      snapshotCategoryBrandRatePct: null,
      snapshotCostProfileVersionIds: [],
      profitSnapshotAt: expect.any(Date),
    });
    // Still unmatched: nothing to fill.
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 0 });

    // The barcode is matched later: the item is captured from the variant.
    await prisma.orderItem.update({
      where: { id: parcel.itemB },
      data: { productVariantId: parcel.variantB },
    });
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 1 });
    const matched = await readItemSnapshot(parcel.itemB);
    // A fresh capture: the item's capture time moves to it.
    expect(matched.profitSnapshotAt?.getTime()).toBeGreaterThan(
      unmatched.profitSnapshotAt?.getTime() ?? Number.POSITIVE_INFINITY,
    );
    expect(matched.snapshotProductVariantId).toBe(parcel.variantB);
    expect(matched.snapshotUnitDesi?.toString()).toBe('1');
    expect(matched.snapshotDesiSource).toBe(SnapshotDesiSource.SYNCED);
    expect(matched.snapshotCategoryId).toBe(TEST_CATEGORY_ID);
    expect(matched.snapshotCategoryRatePct?.toString()).toBe('18');
    expect(sorted(matched.snapshotCostProfileVersionIds)).toEqual(
      await linkedCostVersionIds(parcel.organizationId, parcel.variantB),
    );

    // Once captured, a later variant edit does not reach it.
    await prisma.productVariant.update({
      where: { id: parcel.variantB },
      data: { syncedDimensionalWeight: '6.00' },
    });
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 0 });
    expect(await readItemSnapshot(parcel.itemB)).toEqual(matched);
  });

  it('fills an empty cost list from a cost linked later, but not a filled one', async () => {
    const parcel = await seedSnapshotParcel();
    // Item A's variant has no cost at intake; item B's has one.
    await prisma.productVariantCostProfile.deleteMany({
      where: { organizationId: parcel.organizationId, productVariantId: parcel.variantA },
    });
    await capture(parcel);
    const itemABefore = await readItemSnapshot(parcel.itemA);
    const itemBBefore = await readItemSnapshot(parcel.itemB);
    expect(itemABefore.snapshotCostProfileVersionIds).toEqual([]);
    expect(itemBBefore.snapshotCostProfileVersionIds).toHaveLength(1);

    // A cost in force at the order date is linked to both variants later.
    for (const productVariantId of [parcel.variantA, parcel.variantB]) {
      await attachCostProfile({
        organizationId: parcel.organizationId,
        storeId: parcel.storeId,
        productVariantId,
        amountGross: '12.00',
        vatRate: '20',
      });
    }
    // Item A also gets a cost whose only version starts after the order date: the
    // first-version rule (chooseCostVersion) still pins that version, as the engine
    // would price it.
    const startsAfterOrderId = randomUUID();
    await attachCostProfileVersions(parcel, parcel.variantA, [
      { id: startsAfterOrderId, effectiveFrom: AFTER_ORDER_DATE, archived: false },
    ]);

    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 1 });
    const itemAAfter = await readItemSnapshot(parcel.itemA);
    expect(itemAAfter.snapshotCostProfileVersionIds).toHaveLength(2);
    expect(itemAAfter.snapshotCostProfileVersionIds).toContain(startsAfterOrderId);
    // A gap fill is not a new capture: the item's capture time stays.
    expect(itemAAfter.profitSnapshotAt).toEqual(itemABefore.profitSnapshotAt);
    expect(sorted(itemAAfter.snapshotCostProfileVersionIds)).toEqual(
      await linkedCostVersionIds(parcel.organizationId, parcel.variantA),
    );
    expect(itemAAfter).toEqual({
      ...itemABefore,
      snapshotCostProfileVersionIds: itemAAfter.snapshotCostProfileVersionIds,
    });
    expect(await readItemSnapshot(parcel.itemB)).toEqual(itemBBefore);
  });

  it('fills an empty cost list on an order excluded from profit, which stays excluded', async () => {
    const parcel = await seedSnapshotParcel();
    // Neither variant has a cost at intake, and the order is excluded from profit.
    await prisma.productVariantCostProfile.deleteMany({
      where: { organizationId: parcel.organizationId },
    });
    await prisma.order.update({
      where: { id: parcel.orderId, organizationId: parcel.organizationId },
      data: {
        profitExcludedAt: new Date(),
        profitExclusionReason: ProfitExclusionReason.COST_DEADLINE_MISSED,
      },
    });

    await expect(capture(parcel)).resolves.toEqual({ orderWritten: true, itemsWritten: 2 });
    expect((await readItemSnapshot(parcel.itemA)).snapshotCostProfileVersionIds).toEqual([]);
    expect((await readItemSnapshot(parcel.itemB)).snapshotCostProfileVersionIds).toEqual([]);

    // A cost in force at the order date is linked to both variants later.
    for (const productVariantId of [parcel.variantA, parcel.variantB]) {
      await attachCostProfile({
        organizationId: parcel.organizationId,
        storeId: parcel.storeId,
        productVariantId,
        amountGross: '12.00',
        vatRate: '20',
      });
    }

    // The gap fill runs as on any order: both empty lists take the late cost (the
    // order detail shows it as the unit cost), while the exclusion stays.
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 2 });
    expect(sorted((await readItemSnapshot(parcel.itemA)).snapshotCostProfileVersionIds)).toEqual(
      await linkedCostVersionIds(parcel.organizationId, parcel.variantA),
    );
    expect(sorted((await readItemSnapshot(parcel.itemB)).snapshotCostProfileVersionIds)).toEqual(
      await linkedCostVersionIds(parcel.organizationId, parcel.variantB),
    );
    expect((await readItemSnapshot(parcel.itemA)).snapshotCostProfileVersionIds).toHaveLength(1);
    const order = await prisma.order.findFirstOrThrow({
      where: { id: parcel.orderId, organizationId: parcel.organizationId },
      select: { profitExcludedAt: true, profitExclusionReason: true },
    });
    expect(order.profitExcludedAt).not.toBeNull();
    expect(order.profitExclusionReason).toBe(ProfitExclusionReason.COST_DEADLINE_MISSED);
  });

  it("follows cost links added or replaced during the order's business day", async () => {
    const parcel = await seedSnapshotParcel();
    // An order placed now: its business day is still open, so the seller may still
    // enter or change its cost (cost-window rule).
    await setOrderDate(parcel, new Date());
    await capture(parcel);
    const itemABefore = await readItemSnapshot(parcel.itemA);
    const itemBBefore = await readItemSnapshot(parcel.itemB);
    expect(itemABefore.snapshotCostProfileVersionIds).toEqual(
      await linkedCostVersionIds(parcel.organizationId, parcel.variantA),
    );
    expect(itemABefore.snapshotCostProfileVersionIds).toHaveLength(1);

    // Added: a second profile is linked to item A's variant.
    await attachCostProfile({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      productVariantId: parcel.variantA,
      amountGross: '12.00',
      vatRate: '20',
    });
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 1 });
    const added = await readItemSnapshot(parcel.itemA);
    expect(added.snapshotCostProfileVersionIds).toHaveLength(2);
    expect(added.snapshotCostProfileVersionIds).toEqual(
      await linkedCostVersionIds(parcel.organizationId, parcel.variantA),
    );
    // Only the cost list moves; the item's capture time stays.
    expect(added).toEqual({
      ...itemABefore,
      snapshotCostProfileVersionIds: added.snapshotCostProfileVersionIds,
    });

    // Replaced: every link of the variant is removed and another profile linked.
    await prisma.productVariantCostProfile.deleteMany({
      where: { organizationId: parcel.organizationId, productVariantId: parcel.variantA },
    });
    await attachCostProfile({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      productVariantId: parcel.variantA,
      amountGross: '40.00',
      vatRate: '20',
    });
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 1 });
    const replaced = await readItemSnapshot(parcel.itemA);
    expect(replaced.snapshotCostProfileVersionIds).toHaveLength(1);
    expect(replaced.snapshotCostProfileVersionIds).toEqual(
      await linkedCostVersionIds(parcel.organizationId, parcel.variantA),
    );
    expect(replaced.snapshotCostProfileVersionIds).not.toContain(
      added.snapshotCostProfileVersionIds[0],
    );
    expect(replaced.snapshotCostProfileVersionIds).not.toContain(
      added.snapshotCostProfileVersionIds[1],
    );

    // Removed: no cost is left, so the list empties.
    await prisma.productVariantCostProfile.deleteMany({
      where: { organizationId: parcel.organizationId, productVariantId: parcel.variantA },
    });
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 1 });
    const removed = await readItemSnapshot(parcel.itemA);
    expect(removed.snapshotCostProfileVersionIds).toEqual([]);
    expect(removed.profitSnapshotAt).toEqual(itemABefore.profitSnapshotAt);

    // Nothing changed for item B, so it was never written.
    expect(await readItemSnapshot(parcel.itemB)).toEqual(itemBBefore);
  });

  it("freezes a filled cost list once the order's business day has ended", async () => {
    const parcel = await seedSnapshotParcel();
    // An order from two days ago: its business day has ended.
    await setOrderDate(parcel, new Date(Date.now() - 2 * DAY_MS));
    await capture(parcel);
    const itemABefore = await readItemSnapshot(parcel.itemA);
    expect(itemABefore.snapshotCostProfileVersionIds).toHaveLength(1);

    // Added: a second profile linked after the day end does not reach the order.
    await attachCostProfile({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      productVariantId: parcel.variantA,
      amountGross: '12.00',
      vatRate: '20',
    });
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 0 });
    expect(await readItemSnapshot(parcel.itemA)).toEqual(itemABefore);

    // Replaced: neither does a replacement of every link.
    await prisma.productVariantCostProfile.deleteMany({
      where: { organizationId: parcel.organizationId, productVariantId: parcel.variantA },
    });
    await attachCostProfile({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      productVariantId: parcel.variantA,
      amountGross: '40.00',
      vatRate: '20',
    });
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 0 });
    expect(await readItemSnapshot(parcel.itemA)).toEqual(itemABefore);
  });

  it('captures a variant without any desi (no correction, no Trendyol desi) as an empty desi with no source', async () => {
    const parcel = await seedSnapshotParcel();
    // Trendyol sent no desi for either variant and the seller corrected neither.
    await prisma.productVariant.update({
      where: { id: parcel.variantA },
      data: { dimensionalWeightOverride: null, syncedDimensionalWeight: null },
    });
    await prisma.productVariant.update({
      where: { id: parcel.variantB },
      data: { syncedDimensionalWeight: null },
    });

    await expect(capture(parcel)).resolves.toEqual({ orderWritten: true, itemsWritten: 2 });
    for (const itemId of [parcel.itemA, parcel.itemB]) {
      const item = await readItemSnapshot(itemId);
      expect(item.snapshotUnitDesi).toBeNull();
      expect(item.snapshotDesiSource).toBeNull();
      // The rest of the item is captured as usual.
      expect(item.profitSnapshotAt).toEqual(expect.any(Date));
      expect(item.snapshotCategoryId).toBe(TEST_CATEGORY_ID);
    }

    // Still no desi anywhere: nothing to write.
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 0 });

    // A desi entered later (a seller correction, a Trendyol desi from a later sync) does
    // not reach the capture: the item captured without a desi stays empty.
    await prisma.productVariant.update({
      where: { id: parcel.variantA },
      data: { dimensionalWeightOverride: '2.50' },
    });
    await prisma.productVariant.update({
      where: { id: parcel.variantB },
      data: { syncedDimensionalWeight: '4.00' },
    });
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 0 });
    for (const itemId of [parcel.itemA, parcel.itemB]) {
      const item = await readItemSnapshot(itemId);
      expect(item.snapshotUnitDesi).toBeNull();
      expect(item.snapshotDesiSource).toBeNull();
    }
  });

  it('keeps a stored synced desi of 0 as a known desi: captured as 0 from the synced value and never filled later', async () => {
    const parcel = await seedSnapshotParcel();
    // Both variants carry a stored synced desi of 0, a real desi (the mapper stores
    // a Trendyol 0 as null, but a stored 0 is a real desi); the seller corrected
    // neither.
    await prisma.productVariant.update({
      where: { id: parcel.variantA },
      data: { dimensionalWeightOverride: null, syncedDimensionalWeight: '0' },
    });
    await prisma.productVariant.update({
      where: { id: parcel.variantB },
      data: { syncedDimensionalWeight: '0' },
    });
    await capture(parcel);
    const itemABefore = await readItemSnapshot(parcel.itemA);
    const itemBBefore = await readItemSnapshot(parcel.itemB);
    for (const item of [itemABefore, itemBBefore]) {
      expect(item.snapshotUnitDesi?.toString()).toBe('0');
      expect(item.snapshotDesiSource).toBe(SnapshotDesiSource.SYNCED);
    }

    // A later seller correction and a later Trendyol desi do not reach the capture:
    // 0 is a known desi, not a gap to fill.
    await prisma.productVariant.update({
      where: { id: parcel.variantA },
      data: { dimensionalWeightOverride: '2.50' },
    });
    await prisma.productVariant.update({
      where: { id: parcel.variantB },
      data: { syncedDimensionalWeight: '4.00' },
    });
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 0 });
    expect(await readItemSnapshot(parcel.itemA)).toEqual(itemABefore);
    expect(await readItemSnapshot(parcel.itemB)).toEqual(itemBBefore);
  });

  it('fills commission inputs that were all missing once a rule or synced rate appears, but never changes captured rates', async () => {
    const parcel = await seedSnapshotParcel();
    const productA = await productIdOf(parcel.variantA);
    const productB = await productIdOf(parcel.variantB);
    // Item A: a zero synced rate (Trendyol's "not sent") and a product without a
    // category or brand. Item B: no synced rate, and a category and brand no rule
    // covers yet.
    await prisma.productVariant.update({
      where: { id: parcel.variantA },
      data: { syncedCommissionRate: '0.00' },
    });
    await prisma.product.update({
      where: { id: productA },
      data: { categoryId: null, brandId: null },
    });
    await prisma.product.update({
      where: { id: productB },
      data: { categoryId: TEST_OTHER_CATEGORY_ID, brandId: TEST_OTHER_BRAND_ID },
    });
    await capture(parcel);
    const itemABefore = await readItemSnapshot(parcel.itemA);
    const itemBBefore = await readItemSnapshot(parcel.itemB);
    expect(itemABefore.snapshotSyncedCommissionRatePct?.toString()).toBe('0');
    expect(itemABefore.snapshotCategoryId).toBeNull();
    expect(itemABefore.snapshotCategoryRatePct).toBeNull();
    expect(itemABefore.snapshotCategoryBrandRatePct).toBeNull();
    expect(itemBBefore.snapshotSyncedCommissionRatePct).toBeNull();
    expect(itemBBefore.snapshotCategoryId).toBe(TEST_OTHER_CATEGORY_ID);
    expect(itemBBefore.snapshotCategoryRatePct).toBeNull();
    expect(itemBBefore.snapshotCategoryBrandRatePct).toBeNull();

    // Nothing gives a rate yet: nothing to fill.
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 0 });

    // Item A: Trendyol sends a synced rate and the product gets this suite's category
    // and brand (both rules exist). Item B: a rule for its captured category appears.
    await prisma.productVariant.update({
      where: { id: parcel.variantA },
      data: { syncedCommissionRate: '12.00' },
    });
    await prisma.product.update({
      where: { id: productA },
      data: { categoryId: TEST_CATEGORY_ID, brandId: TEST_BRAND_ID },
    });
    await prisma.marketplaceCommissionRate.create({
      data: {
        platform: Platform.TRENDYOL,
        ruleKind: CommissionRuleKind.CATEGORY,
        categoryId: TEST_OTHER_CATEGORY_ID,
        brandId: null,
        categoryName: 'Snapshot test other category',
        parentCategoryName: null,
        brandName: null,
        baseRate: '21.00',
        paymentTermDays: 60,
        segmentOverrides: {},
        fetchedAt: new Date(),
        sourceScreen: 'CategoryCommissionPaymentTerms',
      },
    });
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 2 });
    const itemAFilled = await readItemSnapshot(parcel.itemA);
    const itemBFilled = await readItemSnapshot(parcel.itemB);
    // A gap fill is not a new capture: everything else, the capture time included, stays.
    expect(itemAFilled).toEqual({
      ...itemABefore,
      snapshotSyncedCommissionRatePct: itemAFilled.snapshotSyncedCommissionRatePct,
      snapshotCategoryId: TEST_CATEGORY_ID,
      snapshotBrandId: TEST_BRAND_ID,
      snapshotCategoryRatePct: itemAFilled.snapshotCategoryRatePct,
      snapshotCategoryBrandRatePct: itemAFilled.snapshotCategoryBrandRatePct,
    });
    expect(itemAFilled.snapshotSyncedCommissionRatePct?.toString()).toBe('12');
    expect(itemAFilled.snapshotCategoryRatePct?.toString()).toBe('18');
    expect(itemAFilled.snapshotCategoryBrandRatePct?.toString()).toBe('16.5');
    // Item B keeps its captured category and brand; only the new rule's rate is written.
    expect(itemBFilled).toEqual({
      ...itemBBefore,
      snapshotCategoryRatePct: itemBFilled.snapshotCategoryRatePct,
    });
    expect(itemBFilled.snapshotCategoryRatePct?.toString()).toBe('21');

    // Captured rates are never changed: new rules, a new synced rate, a new category.
    await prisma.marketplaceCommissionRate.updateMany({
      where: { platform: Platform.TRENDYOL, categoryId: { in: SUITE_CATEGORY_IDS } },
      data: { baseRate: '40.00' },
    });
    await prisma.productVariant.update({
      where: { id: parcel.variantA },
      data: { syncedCommissionRate: '30.00' },
    });
    await prisma.productVariant.update({
      where: { id: parcel.variantB },
      data: { syncedCommissionRate: '25.00' },
    });
    await prisma.product.update({
      where: { id: productB },
      data: { categoryId: TEST_CATEGORY_ID, brandId: TEST_BRAND_ID },
    });
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 0 });
    expect(await readItemSnapshot(parcel.itemA)).toEqual(itemAFilled);
    expect(await readItemSnapshot(parcel.itemB)).toEqual(itemBFilled);
  });

  it('pins the cost version in force at the order date, not the latest', async () => {
    const parcel = await seedSnapshotParcel();
    // The melontik COGS profile has a single version. The seed sets only its
    // changedAt, so its effectiveFrom is the database default (the seed instant),
    // which is after the order date: chooseCostVersion's first-version rule picks it.
    const cogsVersionIds = await linkedCostVersionIds(parcel.organizationId, parcel.variantA);
    expect(cogsVersionIds).toHaveLength(1);
    const cogsVersions = await prisma.costProfileVersion.findMany({
      where: { id: { in: cogsVersionIds } },
      select: { effectiveFrom: true },
    });
    expect(
      cogsVersions.every(
        (version) => version.effectiveFrom.getTime() > MELONTIK.orderDate.getTime(),
      ),
    ).toBe(true);
    // Linked after the COGS profile but with the lower id, so a stored list in link
    // order would not be sorted.
    const inForceId = lowSortingId();
    const latestId = randomUUID();
    await attachCostProfileVersions(parcel, parcel.variantA, [
      { id: inForceId, effectiveFrom: BEFORE_ORDER_DATE, archived: false },
      { id: latestId, effectiveFrom: AFTER_ORDER_DATE, archived: false },
    ]);

    await capture(parcel);

    const itemA = await readItemSnapshot(parcel.itemA);
    expect(sorted(itemA.snapshotCostProfileVersionIds)).toEqual(
      sorted([...cogsVersionIds, inForceId]),
    );
    expect(itemA.snapshotCostProfileVersionIds).not.toContain(latestId);
    // The stored list is in ascending id order.
    expect(itemA.snapshotCostProfileVersionIds).toEqual(
      sorted(itemA.snapshotCostProfileVersionIds),
    );
  });

  it('skips a cost profile whose version in force at the order date is archived', async () => {
    const parcel = await seedSnapshotParcel();
    const cogsVersionIds = await linkedCostVersionIds(parcel.organizationId, parcel.variantA);
    expect(cogsVersionIds).toHaveLength(1);
    // Archived at the order date, restored later: the version in force is archived.
    const archivedInForceId = randomUUID();
    const restoredLaterId = randomUUID();
    await attachCostProfileVersions(parcel, parcel.variantA, [
      { id: archivedInForceId, effectiveFrom: BEFORE_ORDER_DATE, archived: true },
      { id: restoredLaterId, effectiveFrom: AFTER_ORDER_DATE, archived: false },
    ]);
    // Live at the order date, archived later: the version in force is usable.
    const liveInForceId = lowSortingId();
    const archivedLaterId = randomUUID();
    await attachCostProfileVersions(parcel, parcel.variantA, [
      { id: liveInForceId, effectiveFrom: BEFORE_ORDER_DATE, archived: false },
      { id: archivedLaterId, effectiveFrom: AFTER_ORDER_DATE, archived: true },
    ]);

    await capture(parcel);

    const itemA = await readItemSnapshot(parcel.itemA);
    expect(itemA.snapshotCostProfileVersionIds).toEqual(sorted([...cogsVersionIds, liveInForceId]));
  });

  it("keeps an item's captured values when its variant is deleted", async () => {
    const parcel = await seedSnapshotParcel();
    await capture(parcel);
    const itemBBefore = await readItemSnapshot(parcel.itemB);
    expect(itemBBefore.snapshotProductVariantId).toBe(parcel.variantB);

    // The variant leaves the catalogue; the item's variant link drops to null.
    await prisma.productVariant.delete({ where: { id: parcel.variantB } });
    const unlinked = await prisma.orderItem.findUniqueOrThrow({
      where: { id: parcel.itemB },
      select: { productVariantId: true },
    });
    expect(unlinked.productVariantId).toBeNull();

    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 0 });
    expect(await readItemSnapshot(parcel.itemB)).toEqual(itemBBefore);
  });

  it('re-captures an item whose variant changes to another variant', async () => {
    const parcel = await seedSnapshotParcel();
    await capture(parcel);
    const itemABefore = await readItemSnapshot(parcel.itemA);
    expect(itemABefore.snapshotProductVariantId).toBe(parcel.variantA);
    expect(itemABefore.snapshotUnitDesi?.toString()).toBe('3.5');

    // Item A is re-matched to variant B: other desi (synced 1), no synced rate, other cost.
    await prisma.orderItem.update({
      where: { id: parcel.itemA },
      data: { productVariantId: parcel.variantB },
    });

    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 1 });
    const itemAAfter = await readItemSnapshot(parcel.itemA);
    expect(itemAAfter.snapshotProductVariantId).toBe(parcel.variantB);
    expect(itemAAfter.snapshotUnitDesi?.toString()).toBe('1');
    expect(itemAAfter.snapshotDesiSource).toBe(SnapshotDesiSource.SYNCED);
    expect(itemAAfter.snapshotSyncedCommissionRatePct).toBeNull();
    expect(itemAAfter.snapshotCostProfileVersionIds).toEqual(
      await linkedCostVersionIds(parcel.organizationId, parcel.variantB),
    );
    expect(itemAAfter.snapshotCostProfileVersionIds).not.toEqual(
      itemABefore.snapshotCostProfileVersionIds,
    );
    // A fresh capture: the item's capture time moves to it.
    expect(itemAAfter.profitSnapshotAt?.getTime()).toBeGreaterThan(
      itemABefore.profitSnapshotAt?.getTime() ?? Number.POSITIVE_INFINITY,
    );
  });

  it('writes nothing for an order of a store that is not on Trendyol', async () => {
    const parcel = await seedSnapshotParcel();
    await prisma.store.update({
      where: { id: parcel.storeId },
      data: { platform: Platform.HEPSIBURADA },
    });

    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 0 });

    expect(await readOrderSnapshot(parcel.orderId)).toEqual({
      snapshotCarrierId: null,
      snapshotCargoProviderName: null,
      snapshotShippingTariffSource: null,
      snapshotIncludeStopaj: null,
      snapshotIncludeNegativeNetVat: null,
      profitSnapshotAt: null,
    });
    for (const orderItemId of [parcel.itemA, parcel.itemB]) {
      const item = await readItemSnapshot(orderItemId);
      expect(item.profitSnapshotAt).toBeNull();
      expect(item.snapshotProductVariantId).toBeNull();
      expect(item.snapshotUnitDesi).toBeNull();
      expect(item.snapshotCostProfileVersionIds).toEqual([]);
    }
  });
});
