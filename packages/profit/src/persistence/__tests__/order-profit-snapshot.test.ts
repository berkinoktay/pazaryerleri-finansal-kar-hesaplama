/**
 * Integration tests for captureOrderProfitSnapshot (plan PR-2, Gorev 2): the order's
 * undated product inputs are copied once, afterwards only missing parts are filled
 * (commission inputs none of which gives a rate), and a known value is never
 * overwritten with a live one. The events that change a filled product value are the
 * order's own cargo name changing and an item's variant changing.
 *
 * The seller inputs (cost list and desi) follow the order's business day (same-day
 * edit window plan PR-1, P1-09; Berkin 2026-11-23: an order's cost and desi are the
 * values in force at the end of its Istanbul business day). While the order's
 * seller-input marker is NULL every capture call re-derives each captured item's cost
 * list and desi from the state at that day end, so a same-day amount edit, attach,
 * detach, archive, restore or desi change reaches the order, and a change stamped
 * after the day end does not. Once the marker is set (the day-close pass made the
 * order final) a filled cost list and a captured desi are frozen; only an empty cost
 * list is still filled, and a desi never is.
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
import { getBusinessDayRange } from '@pazarsync/utils';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { costDecisionTime } from '../../core/seller-costs/cost-profile-in-force';
import {
  captureOrderProfitSnapshot,
  type OrderProfitSnapshotOutcome,
} from '../order-profit-snapshot';
import {
  attachCostProfile,
  backdateSellerInputHistory,
  clearSellerInputHistory,
  COST_FIXTURE_EPOCH,
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
  // Fixture setup, not history: item A's variant carried that desi all along.
  await clearSellerInputHistory(parcel.organizationId);
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

/** A cost version start before the melontik order date (2026-10-28): in force at its day end. */
const BEFORE_ORDER_DATE = new Date('2026-10-01T00:00:00Z');
/** A cost version start after the melontik order's day end: not yet in force at it. */
const AFTER_ORDER_DATE = new Date('2026-11-10T00:00:00Z');

const HOUR_MS = 60 * 60 * 1000;

/** The end of the melontik order's business day: the decision time of the cost rule. */
const ORDER_DAY_END = costDecisionTime(MELONTIK.orderDate);

/** An instant after the melontik order's business day ended. */
const AFTER_ORDER_DAY_END = new Date(ORDER_DAY_END.getTime() + HOUR_MS);

/** An instant `hours` after the melontik order, still on its business day (it ends 12 h later). */
function laterOnOrderDay(hours: number): Date {
  return new Date(MELONTIK.orderDate.getTime() + hours * HOUR_MS);
}

/**
 * Instants on today's business day, `hours` after its start, from one anchor taken
 * once: a test that places today's order and stamps its later cost edits with it can
 * never straddle midnight.
 */
function todaysBusinessDay(): (hours: number) => Date {
  const { start } = getBusinessDayRange(new Date());
  return (hours) => new Date(start.getTime() + hours * HOUR_MS);
}

/** One version of a test cost profile; `archived` marks the profile archived from this version on. */
interface TestCostVersionSpec {
  readonly id: string;
  readonly effectiveFrom: Date;
  readonly archived: boolean;
  /** Per-unit gross amount; omitted = '30.00'. */
  readonly amountGross?: string;
}

/**
 * Links a new packaging profile to the variant with the given versions, numbered
 * 1, 2, ... in the given order. The caller picks the version ids so it can assert
 * on them and steer their sort order. The link's `attachedAt` defaults to
 * COST_FIXTURE_EPOCH (linked before any order date).
 */
async function attachCostProfileVersions(
  parcel: MelontikParcel,
  productVariantId: string,
  versions: readonly TestCostVersionSpec[],
  opts: { readonly attachedAt?: Date } = {},
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
        amountGross: spec.amountGross ?? '30.00',
        vatRate: '20',
        changedFields: [],
        effectiveFrom: spec.effectiveFrom,
        archivedAt: spec.archived ? spec.effectiveFrom : null,
      },
    });
  }
  await prisma.productVariantCostProfile.create({
    data: {
      organizationId: parcel.organizationId,
      productVariantId,
      profileId: profile.id,
      attachedAt: opts.attachedAt ?? COST_FIXTURE_EPOCH,
    },
  });
}

/**
 * Archives a cost profile at `at` as the archive action does: the profile row is
 * marked archived and the next version, a copy of the latest one, starts at `at` as
 * the archive version.
 */
async function archiveCostProfileAt(
  organizationId: string,
  profileId: string,
  at: Date,
): Promise<void> {
  const latest = await prisma.costProfileVersion.findFirstOrThrow({
    where: { organizationId, profileId },
    orderBy: { version: 'desc' },
  });
  await prisma.costProfile.update({
    where: { id: profileId, organizationId },
    data: { archivedAt: at },
  });
  await prisma.costProfileVersion.create({
    data: {
      profileId,
      organizationId,
      version: latest.version + 1,
      name: latest.name,
      type: latest.type,
      amountGross: latest.amountGross,
      vatRate: latest.vatRate,
      changedFields: ['archivedAt'],
      effectiveFrom: at,
      archivedAt: at,
    },
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

/** A set seller-input marker: the day-close pass has made the order's seller inputs final. */
const SELLER_INPUTS_FINAL_AT = new Date();

/** The id the map holds for `key`; throws when it holds none (a fixture bug). */
function requireMapped(ids: ReadonlyMap<string, string>, key: string): string {
  const id = ids.get(key);
  if (id === undefined) {
    throw new Error(`No twin item for order item ${key}`);
  }
  return id;
}

/**
 * A second order in the parcel's store with the parcel order's date, cargo name and
 * two items on the same variants: one seller-input change reaches both orders, and
 * only `sellerInputsFinalAt` tells them apart. Returned in the parcel's shape so
 * `capture` and `readItemSnapshot` work on it unchanged.
 */
async function seedOrderTwin(
  parcel: MelontikParcel,
  opts: { readonly sellerInputsFinalAt: Date | null },
): Promise<MelontikParcel> {
  const source = await prisma.order.findFirstOrThrow({
    where: { id: parcel.orderId, organizationId: parcel.organizationId },
    include: { items: true },
  });
  const platformOrderId = `twin-${randomUUID().slice(0, 8)}`;
  const twin = await prisma.order.create({
    data: {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      platformOrderId,
      orderDate: source.orderDate,
      status: source.status,
      isExportSale: source.isExportSale,
      fastDelivery: source.fastDelivery,
      fastDeliveryType: source.fastDeliveryType,
      usesSellerCargoAgreement: source.usesSellerCargoAgreement,
      cargoProviderName: source.cargoProviderName,
      sellerInputsFinalAt: opts.sellerInputsFinalAt,
    },
  });
  const twinItemIds = new Map<string, string>();
  for (const item of source.items) {
    const created = await prisma.orderItem.create({
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
    twinItemIds.set(item.id, created.id);
  }
  return {
    ...parcel,
    orderId: twin.id,
    platformOrderId,
    itemA: requireMapped(twinItemIds, parcel.itemA),
    itemB: requireMapped(twinItemIds, parcel.itemB),
  };
}

/** The profile of the variant's one cost link. */
async function onlyCostProfileIdOf(
  parcel: MelontikParcel,
  productVariantId: string,
): Promise<string> {
  const link = await prisma.productVariantCostProfile.findFirstOrThrow({
    where: { organizationId: parcel.organizationId, productVariantId },
    select: { profileId: true },
  });
  return link.profileId;
}

/**
 * Writes the next version of a cost profile as the edit and restore actions do: a
 * live copy of the latest version with the given amount, starting at the database's
 * transaction instant (the column default), and the profile row updated to match.
 * Returns the new version id.
 */
async function addLiveCostVersion(
  organizationId: string,
  profileId: string,
  change: { readonly amountGross?: string; readonly changedField: 'amountGross' | 'archivedAt' },
): Promise<string> {
  const latest = await prisma.costProfileVersion.findFirstOrThrow({
    where: { organizationId, profileId },
    orderBy: { version: 'desc' },
  });
  const amountGross = change.amountGross ?? latest.amountGross;
  await prisma.costProfile.update({
    where: { id: profileId, organizationId },
    data: { amountGross, archivedAt: null },
  });
  const created = await prisma.costProfileVersion.create({
    data: {
      profileId,
      organizationId,
      version: latest.version + 1,
      name: latest.name,
      type: latest.type,
      amountGross,
      vatRate: latest.vatRate,
      changedFields: [change.changedField],
      archivedAt: null,
    },
  });
  return created.id;
}

/** What a seller-input change leaves on the order item it reaches. */
type ReachedItem =
  | {
      readonly kind: 'costList';
      readonly item: 'itemA' | 'itemB';
      readonly versionIds: readonly string[];
    }
  | {
      readonly kind: 'desi';
      readonly item: 'itemA' | 'itemB';
      readonly desi: string | null;
      readonly source: SnapshotDesiSource | null;
    };

/** A seller-input change made after the first capture; reports what the reached item holds then. */
type SellerInputChange = () => Promise<ReachedItem>;

/**
 * Arranges the parcel's variants before the first capture and returns the change.
 * Every write is real and stamped now, on today's business day.
 */
type SellerInputChangeCase = (parcel: MelontikParcel) => Promise<SellerInputChange>;

/**
 * The nine seller-input changes of the same-day edit window (plan PR-1, P1-09). The
 * parcel is the snapshot parcel: item A's variant has a seller desi of 3.50 over a
 * synced 1 and one COGS link, item B's variant a synced desi of 1 and one COGS link.
 */
const SELLER_INPUT_CHANGES = {
  // The seller edits the amount of item A's cost: a new version starts now.
  'amount edit': async (parcel) => async () => {
    const profileId = await onlyCostProfileIdOf(parcel, parcel.variantA);
    const versionId = await addLiveCostVersion(parcel.organizationId, profileId, {
      amountGross: '250.00',
      changedField: 'amountGross',
    });
    return { kind: 'costList', item: 'itemA', versionIds: [versionId] };
  },
  // A second profile is linked to item A's variant.
  attach: async (parcel) => async () => {
    await attachCostProfile({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      productVariantId: parcel.variantA,
      amountGross: '12.00',
      vatRate: '20',
      attachedAt: new Date(),
    });
    return {
      kind: 'costList',
      item: 'itemA',
      versionIds: await linkedCostVersionIds(parcel.organizationId, parcel.variantA),
    };
  },
  // Item A's only cost link is removed.
  detach: async (parcel) => async () => {
    await prisma.productVariantCostProfile.deleteMany({
      where: { organizationId: parcel.organizationId, productVariantId: parcel.variantA },
    });
    return { kind: 'costList', item: 'itemA', versionIds: [] };
  },
  // Item A's only cost profile is archived.
  archive: async (parcel) => async () => {
    const profileId = await onlyCostProfileIdOf(parcel, parcel.variantA);
    await archiveCostProfileAt(parcel.organizationId, profileId, new Date());
    return { kind: 'costList', item: 'itemA', versionIds: [] };
  },
  // A second profile of item A's variant, archived since before the order, is restored.
  restore: async (parcel) => {
    const cogsVersionIds = await linkedCostVersionIds(parcel.organizationId, parcel.variantA);
    const firstVersionId = randomUUID();
    await attachCostProfileVersions(parcel, parcel.variantA, [
      { id: firstVersionId, effectiveFrom: COST_FIXTURE_EPOCH, archived: false },
      { id: randomUUID(), effectiveFrom: BEFORE_ORDER_DATE, archived: true },
    ]);
    const archived = await prisma.costProfileVersion.findUniqueOrThrow({
      where: { id: firstVersionId },
      select: { profileId: true },
    });
    return async () => {
      const restoredId = await addLiveCostVersion(parcel.organizationId, archived.profileId, {
        changedField: 'archivedAt',
      });
      return { kind: 'costList', item: 'itemA', versionIds: [...cogsVersionIds, restoredId] };
    };
  },
  // Item A's variant has no desi at all until the seller enters one.
  'seller desi set': async (parcel) => {
    await prisma.productVariant.update({
      where: { id: parcel.variantA },
      data: { dimensionalWeightOverride: null, syncedDimensionalWeight: null },
    });
    return async () => {
      await prisma.productVariant.update({
        where: { id: parcel.variantA },
        data: { dimensionalWeightOverride: '5.00' },
      });
      return { kind: 'desi', item: 'itemA', desi: '5', source: SnapshotDesiSource.OVERRIDE };
    };
  },
  // The seller changes item A's desi 3.50 -> 7.00.
  'seller desi changed': async (parcel) => async () => {
    await prisma.productVariant.update({
      where: { id: parcel.variantA },
      data: { dimensionalWeightOverride: '7.00' },
    });
    return { kind: 'desi', item: 'itemA', desi: '7', source: SnapshotDesiSource.OVERRIDE };
  },
  // The seller clears item A's desi: the synced 1 applies again.
  'seller desi cleared': async (parcel) => async () => {
    await prisma.productVariant.update({
      where: { id: parcel.variantA },
      data: { dimensionalWeightOverride: null },
    });
    return { kind: 'desi', item: 'itemA', desi: '1', source: SnapshotDesiSource.SYNCED };
  },
  // Trendyol sends a new desi for item B's variant, which has no seller desi.
  'synced desi changed': async (parcel) => async () => {
    await prisma.productVariant.update({
      where: { id: parcel.variantB },
      data: { syncedDimensionalWeight: '4.00' },
    });
    return { kind: 'desi', item: 'itemB', desi: '4', source: SnapshotDesiSource.SYNCED };
  },
} satisfies Readonly<Record<string, SellerInputChangeCase>>;

/** SELLER_INPUT_CHANGES as (name, case) pairs, in declaration order. */
const SELLER_INPUT_CHANGE_LIST: readonly (readonly [string, SellerInputChangeCase])[] =
  Object.entries(SELLER_INPUT_CHANGES);

/** The item snapshot as `readItemSnapshot` returns it. */
type ItemSnapshot = Awaited<ReturnType<typeof readItemSnapshot>>;

/**
 * Asserts that the reached item holds exactly what the change reports and is
 * otherwise as it was: no other column moved, its capture time included.
 */
function expectReached(before: ItemSnapshot, after: ItemSnapshot, reached: ReachedItem): void {
  switch (reached.kind) {
    case 'costList':
      expect(after).toEqual({
        ...before,
        snapshotCostProfileVersionIds: sorted(reached.versionIds),
      });
      return;
    case 'desi':
      expect(after.snapshotUnitDesi?.toString() ?? null).toBe(reached.desi);
      expect(after.snapshotDesiSource).toBe(reached.source);
      expect({ ...after, snapshotUnitDesi: null, snapshotDesiSource: null }).toEqual({
        ...before,
        snapshotUnitDesi: null,
        snapshotDesiSource: null,
      });
      return;
    default: {
      const exhaustive: never = reached;
      throw new Error(`Unhandled reached item: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** The other item of the parcel: the one a change does not reach. */
function otherItem(item: 'itemA' | 'itemB'): 'itemA' | 'itemB' {
  return item === 'itemA' ? 'itemB' : 'itemA';
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

  it('a final order keeps captured values when the variant desi, synced rate, category rule, cost link and store tariff source change; its non-final twin follows only the seller inputs', async () => {
    const parcel = await seedSnapshotParcel({ sellerInputsFinalAt: SELLER_INPUTS_FINAL_AT });
    // Positive control: the same items on the same variants, seller inputs not final.
    const twin = await seedOrderTwin(parcel, { sellerInputsFinalAt: null });
    await capture(parcel);
    await capture(twin);
    const orderBefore = await readOrderSnapshot(parcel.orderId);
    const itemABefore = await readItemSnapshot(parcel.itemA);
    const itemBBefore = await readItemSnapshot(parcel.itemB);
    const twinABefore = await readItemSnapshot(twin.itemA);
    const twinBBefore = await readItemSnapshot(twin.itemB);

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
    // Every seller-input change above happened on the order's day: the day-end state
    // holds the new desi and the new cost link, so only the marker keeps them out.
    await backdateSellerInputHistory(parcel.organizationId, laterOnOrderDay(1));

    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 0 });

    expect(await readOrderSnapshot(parcel.orderId)).toEqual(orderBefore);
    const itemAAfter = await readItemSnapshot(parcel.itemA);
    expect(itemAAfter).toEqual(itemABefore);
    expect(itemAAfter.snapshotCategoryId).toBe(TEST_CATEGORY_ID);
    expect(await readItemSnapshot(parcel.itemB)).toEqual(itemBBefore);

    // Positive control: the non-final twin takes the day-end desi and cost list, and
    // nothing else (its product inputs stay as captured).
    await expect(capture(twin)).resolves.toEqual({ orderWritten: false, itemsWritten: 2 });
    const twinAAfter = await readItemSnapshot(twin.itemA);
    expect(twinAAfter.snapshotUnitDesi?.toString()).toBe('7');
    expect(twinAAfter).toEqual({
      ...twinABefore,
      snapshotUnitDesi: twinAAfter.snapshotUnitDesi,
      snapshotCostProfileVersionIds: await linkedCostVersionIds(
        parcel.organizationId,
        parcel.variantA,
      ),
    });
    expect(twinAAfter.snapshotCostProfileVersionIds).not.toEqual(
      twinABefore.snapshotCostProfileVersionIds,
    );
    const twinBAfter = await readItemSnapshot(twin.itemB);
    expect(twinBAfter.snapshotUnitDesi?.toString()).toBe('4');
    expect(twinBAfter).toEqual({ ...twinBBefore, snapshotUnitDesi: twinBAfter.snapshotUnitDesi });
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
    // A final order: a variant matched later is still captured, from the day-end state,
    // and is frozen afterwards.
    const parcel = await seedSnapshotParcel({ sellerInputsFinalAt: SELLER_INPUTS_FINAL_AT });
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

    // Positive control for the guard below: the same items, both matched now, on an
    // order whose seller inputs still follow its day; captured before the edit, so its
    // next capture is a re-derive.
    const twin = await seedOrderTwin(parcel, { sellerInputsFinalAt: null });
    await expect(capture(twin)).resolves.toEqual({ orderWritten: true, itemsWritten: 2 });
    expect((await readItemSnapshot(twin.itemB)).snapshotUnitDesi?.toString()).toBe('1');

    // Once captured, a later variant edit does not reach the final order, not even one
    // stamped on the order's day (the day-end state now holds it).
    await prisma.productVariant.update({
      where: { id: parcel.variantB },
      data: { syncedDimensionalWeight: '6.00' },
    });
    await backdateSellerInputHistory(parcel.organizationId, laterOnOrderDay(1));
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 0 });
    expect(await readItemSnapshot(parcel.itemB)).toEqual(matched);

    // The non-final twin does take the edit stamped on the order's day.
    await expect(capture(twin)).resolves.toEqual({ orderWritten: false, itemsWritten: 1 });
    const twinB = await readItemSnapshot(twin.itemB);
    expect(twinB.snapshotUnitDesi?.toString()).toBe('6');
    expect(twinB.snapshotDesiSource).toBe(SnapshotDesiSource.SYNCED);
  });

  it('a cost linked later the same day fills an empty list and reaches a filled one; a final order only gets the empty one filled', async () => {
    const parcel = await seedSnapshotParcel();
    // Item A's variant has no cost at intake; item B's has one.
    await prisma.productVariantCostProfile.deleteMany({
      where: { organizationId: parcel.organizationId, productVariantId: parcel.variantA },
    });
    // Fixture setup, not history: item A's variant had no link on the order's day.
    await clearSellerInputHistory(parcel.organizationId);
    const finalTwin = await seedOrderTwin(parcel, { sellerInputsFinalAt: SELLER_INPUTS_FINAL_AT });
    await capture(parcel);
    await capture(finalTwin);
    const itemABefore = await readItemSnapshot(parcel.itemA);
    const itemBBefore = await readItemSnapshot(parcel.itemB);
    const finalBBefore = await readItemSnapshot(finalTwin.itemB);
    expect(itemABefore.snapshotCostProfileVersionIds).toEqual([]);
    expect(itemBBefore.snapshotCostProfileVersionIds).toHaveLength(1);

    // A cost is linked to both variants later the same day, before the day end.
    for (const productVariantId of [parcel.variantA, parcel.variantB]) {
      await attachCostProfile({
        organizationId: parcel.organizationId,
        storeId: parcel.storeId,
        productVariantId,
        amountGross: '12.00',
        vatRate: '20',
        attachedAt: laterOnOrderDay(1),
      });
    }
    // Item A also gets a cost whose only version starts after the order instant but
    // before the day ended: it is the version in force at the day end, so it is
    // pinned, as the engine would price it.
    const startsAfterOrderId = randomUUID();
    await attachCostProfileVersions(
      parcel,
      parcel.variantA,
      [{ id: startsAfterOrderId, effectiveFrom: laterOnOrderDay(1), archived: false }],
      { attachedAt: laterOnOrderDay(1) },
    );

    // Not final: both items follow the links in force at the day end.
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 2 });
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
    const itemBAfter = await readItemSnapshot(parcel.itemB);
    expect(itemBAfter.snapshotCostProfileVersionIds).toHaveLength(2);
    expect(itemBAfter).toEqual({
      ...itemBBefore,
      snapshotCostProfileVersionIds: await linkedCostVersionIds(
        parcel.organizationId,
        parcel.variantB,
      ),
    });

    // Final: the empty list is filled, the filled one stays as captured.
    await expect(capture(finalTwin)).resolves.toEqual({ orderWritten: false, itemsWritten: 1 });
    expect(sorted((await readItemSnapshot(finalTwin.itemA)).snapshotCostProfileVersionIds)).toEqual(
      await linkedCostVersionIds(parcel.organizationId, parcel.variantA),
    );
    expect(await readItemSnapshot(finalTwin.itemB)).toEqual(finalBBefore);
  });

  it('fills an empty cost list on an order excluded from profit, which stays excluded', async () => {
    const parcel = await seedSnapshotParcel();
    // Neither variant has a cost at intake, and the order is excluded from profit.
    await prisma.productVariantCostProfile.deleteMany({
      where: { organizationId: parcel.organizationId },
    });
    // Fixture setup, not history: neither variant had a link on the order's day.
    await clearSellerInputHistory(parcel.organizationId);
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

    // A cost in force at the day end (the factory backdates the link) is linked to both
    // variants later.
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

  it("a same-day replacement of every cost link moves today's captured order to the new profile", async () => {
    const parcel = await seedSnapshotParcel();
    // An order placed today: its business day is still open, so its cost list follows
    // the links in force at the day end (Berkin 2026-11-23).
    const today = todaysBusinessDay();
    await setOrderDate(parcel, today(1));
    await capture(parcel);
    const itemABefore = await readItemSnapshot(parcel.itemA);
    const itemBBefore = await readItemSnapshot(parcel.itemB);
    expect(itemABefore.snapshotCostProfileVersionIds).toEqual(
      await linkedCostVersionIds(parcel.organizationId, parcel.variantA),
    );
    expect(itemABefore.snapshotCostProfileVersionIds).toHaveLength(1);

    // Replaced later the same day: every link of the variant is removed and another
    // profile linked.
    await prisma.productVariantCostProfile.deleteMany({
      where: { organizationId: parcel.organizationId, productVariantId: parcel.variantA },
    });
    await attachCostProfile({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      productVariantId: parcel.variantA,
      amountGross: '40.00',
      vatRate: '20',
      attachedAt: today(2),
    });
    const replacementVersionIds = await linkedCostVersionIds(
      parcel.organizationId,
      parcel.variantA,
    );
    expect(replacementVersionIds).toHaveLength(1);
    expect(replacementVersionIds).not.toEqual(itemABefore.snapshotCostProfileVersionIds);

    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 1 });
    expect(await readItemSnapshot(parcel.itemA)).toEqual({
      ...itemABefore,
      snapshotCostProfileVersionIds: replacementVersionIds,
    });
    expect(await readItemSnapshot(parcel.itemB)).toEqual(itemBBefore);
  });

  it("a same-day archive plus a new attach moves today's captured order from the archived profile to the new one, never both", async () => {
    const parcel = await seedSnapshotParcel();
    const today = todaysBusinessDay();
    await setOrderDate(parcel, today(1));
    // Item A's variant is priced by one profile, A, alone.
    await prisma.productVariantCostProfile.deleteMany({
      where: { organizationId: parcel.organizationId, productVariantId: parcel.variantA },
    });
    const profileA = await attachCostProfile({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      productVariantId: parcel.variantA,
      amountGross: '30.00',
      vatRate: '20',
    });
    const profileAVersionIds = await linkedCostVersionIds(parcel.organizationId, parcel.variantA);
    expect(profileAVersionIds).toHaveLength(1);
    await capture(parcel);
    const itemABefore = await readItemSnapshot(parcel.itemA);
    expect(itemABefore.snapshotCostProfileVersionIds).toEqual(profileAVersionIds);

    // Later the same day the seller archives A and links a new profile B in its place.
    await archiveCostProfileAt(parcel.organizationId, profileA, today(2));
    const profileB = await attachCostProfile({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      productVariantId: parcel.variantA,
      amountGross: '40.00',
      vatRate: '20',
      effectiveFrom: today(3),
      attachedAt: today(3),
    });
    const profileBVersions = await prisma.costProfileVersion.findMany({
      where: { organizationId: parcel.organizationId, profileId: profileB },
      select: { id: true },
    });
    expect(profileBVersions).toHaveLength(1);

    // At the day end A is archived and B is in force: the order is priced by B alone,
    // never by A and B together.
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 1 });
    expect(await readItemSnapshot(parcel.itemA)).toEqual({
      ...itemABefore,
      snapshotCostProfileVersionIds: profileBVersions.map((version) => version.id),
    });
  });

  it("a same-day detach empties today's captured cost list", async () => {
    const parcel = await seedSnapshotParcel();
    const today = todaysBusinessDay();
    await setOrderDate(parcel, today(1));
    await capture(parcel);
    const itemABefore = await readItemSnapshot(parcel.itemA);
    expect(itemABefore.snapshotCostProfileVersionIds).toHaveLength(1);

    // Later the same day every cost link of item A's variant is removed.
    await prisma.productVariantCostProfile.deleteMany({
      where: { organizationId: parcel.organizationId, productVariantId: parcel.variantA },
    });

    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 1 });
    expect(await readItemSnapshot(parcel.itemA)).toEqual({
      ...itemABefore,
      snapshotCostProfileVersionIds: [],
    });
  });

  it("a same-day extra attach reaches today's already captured order", async () => {
    const parcel = await seedSnapshotParcel();
    const today = todaysBusinessDay();
    await setOrderDate(parcel, today(1));
    await capture(parcel);
    const itemABefore = await readItemSnapshot(parcel.itemA);
    expect(itemABefore.snapshotCostProfileVersionIds).toHaveLength(1);

    // Later the same day a second, long-standing profile is linked to item A's variant.
    await attachCostProfile({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      productVariantId: parcel.variantA,
      amountGross: '12.00',
      vatRate: '20',
      attachedAt: today(2),
    });
    const bothVersionIds = await linkedCostVersionIds(parcel.organizationId, parcel.variantA);
    expect(bothVersionIds).toHaveLength(2);

    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 1 });
    expect(await readItemSnapshot(parcel.itemA)).toEqual({
      ...itemABefore,
      snapshotCostProfileVersionIds: bothVersionIds,
    });
  });

  // Same-day edit window (plan PR-1, P1-09): while the order's seller-input marker is
  // NULL, one capture call re-derives a captured item's cost list and desi from the
  // state at the order's day end. Today's order is dated now (never "a few minutes
  // ago": just after midnight that would be yesterday), and every change is a real
  // write stamped now, on its business day.
  it.each(SELLER_INPUT_CHANGE_LIST)(
    "the %s change reaches today's non-final order on one capture",
    async (_name, changeCase) => {
      const parcel = await seedSnapshotParcel();
      await setOrderDate(parcel, new Date());
      const change = await changeCase(parcel);
      await capture(parcel);
      const itemABefore = await readItemSnapshot(parcel.itemA);
      const itemBBefore = await readItemSnapshot(parcel.itemB);
      const before = { itemA: itemABefore, itemB: itemBBefore };

      const reached = await change();

      await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 1 });
      expectReached(before[reached.item], await readItemSnapshot(parcel[reached.item]), reached);
      const untouched = otherItem(reached.item);
      expect(await readItemSnapshot(parcel[untouched])).toEqual(before[untouched]);
    },
  );

  it('a second identical capture writes 0 items after a change', async () => {
    const parcel = await seedSnapshotParcel();
    await setOrderDate(parcel, new Date());
    await capture(parcel);

    await prisma.productVariant.update({
      where: { id: parcel.variantA },
      data: { dimensionalWeightOverride: '7.00' },
    });

    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 1 });
    const afterFirst = await readItemSnapshot(parcel.itemA);
    expect(afterFirst.snapshotUnitDesi?.toString()).toBe('7');
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 0 });
    expect(await readItemSnapshot(parcel.itemA)).toEqual(afterFirst);
  });

  it("yesterday's non-final order keeps a profile detached after its day end and loses one detached before it", async () => {
    const parcel = await seedSnapshotParcel();
    const orderDate = new Date(Date.now() - DAY_MS);
    await setOrderDate(parcel, orderDate);
    const dayEnd = costDecisionTime(orderDate);
    const cogsVersionIds = await linkedCostVersionIds(parcel.organizationId, parcel.variantA);
    expect(cogsVersionIds).toHaveLength(1);
    const packagingId = await attachCostProfile({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      productVariantId: parcel.variantA,
      amountGross: '12.00',
      vatRate: '20',
    });
    await capture(parcel);
    const itemABefore = await readItemSnapshot(parcel.itemA);
    expect(itemABefore.snapshotCostProfileVersionIds).toEqual(
      await linkedCostVersionIds(parcel.organizationId, parcel.variantA),
    );
    expect(itemABefore.snapshotCostProfileVersionIds).toHaveLength(2);

    // The second profile was detached an hour before the order's day ended...
    await prisma.productVariantCostProfile.deleteMany({
      where: { organizationId: parcel.organizationId, profileId: packagingId },
    });
    await backdateSellerInputHistory(parcel.organizationId, new Date(dayEnd.getTime() - HOUR_MS));
    // ...while the COGS link is detached now, after the day end.
    await prisma.productVariantCostProfile.deleteMany({
      where: { organizationId: parcel.organizationId, productVariantId: parcel.variantA },
    });

    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 1 });
    expect(await readItemSnapshot(parcel.itemA)).toEqual({
      ...itemABefore,
      snapshotCostProfileVersionIds: cogsVersionIds,
    });
  });

  // The control above, inverted: a final order's items never move with the same
  // changes. Positive control: its non-final twin (same items on the same variants,
  // marker NULL) does move in the same test.
  it.each(SELLER_INPUT_CHANGE_LIST)(
    'a final order keeps its captured items through the %s change',
    async (_name, changeCase) => {
      const parcel = await seedSnapshotParcel();
      await setOrderDate(parcel, new Date());
      const finalTwin = await seedOrderTwin(parcel, {
        sellerInputsFinalAt: SELLER_INPUTS_FINAL_AT,
      });
      const change = await changeCase(parcel);
      await capture(parcel);
      await capture(finalTwin);
      const finalABefore = await readItemSnapshot(finalTwin.itemA);
      const finalBBefore = await readItemSnapshot(finalTwin.itemB);
      const before = {
        itemA: await readItemSnapshot(parcel.itemA),
        itemB: await readItemSnapshot(parcel.itemB),
      };

      const reached = await change();

      await expect(capture(finalTwin)).resolves.toEqual({ orderWritten: false, itemsWritten: 0 });
      expect(await readItemSnapshot(finalTwin.itemA)).toEqual(finalABefore);
      expect(await readItemSnapshot(finalTwin.itemB)).toEqual(finalBBefore);

      // Positive control: the same change reaches the non-final twin.
      await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 1 });
      expectReached(before[reached.item], await readItemSnapshot(parcel[reached.item]), reached);
    },
  );

  it('profitSnapshotAt does not move on a re-derive; a variant change moves it', async () => {
    const parcel = await seedSnapshotParcel();
    await setOrderDate(parcel, new Date());
    await capture(parcel);
    const itemABefore = await readItemSnapshot(parcel.itemA);

    // A same-day desi change: the item is re-derived (one item written, the new desi),
    // its capture time stays.
    await prisma.productVariant.update({
      where: { id: parcel.variantA },
      data: { dimensionalWeightOverride: '7.00' },
    });
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 1 });
    const rederived = await readItemSnapshot(parcel.itemA);
    expect(rederived.snapshotUnitDesi?.toString()).toBe('7');
    expect(rederived.snapshotDesiSource).toBe(SnapshotDesiSource.OVERRIDE);
    expect(rederived.profitSnapshotAt).toEqual(itemABefore.profitSnapshotAt);

    // Positive control: re-matched to another variant, the item is captured afresh.
    await prisma.orderItem.update({
      where: { id: parcel.itemA },
      data: { productVariantId: parcel.variantB },
    });
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 1 });
    const recaptured = await readItemSnapshot(parcel.itemA);
    expect(recaptured.profitSnapshotAt?.getTime()).toBeGreaterThan(
      itemABefore.profitSnapshotAt?.getTime() ?? Number.POSITIVE_INFINITY,
    );
  });

  it('an archived-then-restored profile pinned at capture stays pinned on the next same-day capture', async () => {
    const parcel = await seedSnapshotParcel();
    const today = todaysBusinessDay();
    await setOrderDate(parcel, today(2));
    const cogsVersionIds = await linkedCostVersionIds(parcel.organizationId, parcel.variantA);
    expect(cogsVersionIds).toHaveLength(1);
    // Archived before the order and restored after it, both today: the restore version
    // is the one in force at the day end, so it prices the order.
    const restoredId = randomUUID();
    await attachCostProfileVersions(parcel, parcel.variantA, [
      { id: randomUUID(), effectiveFrom: COST_FIXTURE_EPOCH, archived: false },
      { id: randomUUID(), effectiveFrom: today(1), archived: true },
      { id: restoredId, effectiveFrom: today(3), archived: false },
    ]);

    await capture(parcel);
    const itemABefore = await readItemSnapshot(parcel.itemA);
    expect(itemABefore.snapshotCostProfileVersionIds).toEqual(
      sorted([...cogsVersionIds, restoredId]),
    );

    // Nothing changed: the next capture the same day re-derives the same list (the
    // restore version) and writes nothing.
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 0 });
    expect(await readItemSnapshot(parcel.itemA)).toEqual(itemABefore);
  });

  it('the day-end version pinned at capture is not replaced by the first version on the next same-day capture', async () => {
    const parcel = await seedSnapshotParcel();
    const today = todaysBusinessDay();
    await setOrderDate(parcel, today(1));
    const cogsVersionIds = await linkedCostVersionIds(parcel.organizationId, parcel.variantA);
    expect(cogsVersionIds).toHaveLength(1);
    // Created after the order instant (100) and edited to 120, both today: the 120
    // version is the one in force at the day end, so it prices the order.
    const firstId = randomUUID();
    const inForceId = randomUUID();
    await attachCostProfileVersions(
      parcel,
      parcel.variantA,
      [
        { id: firstId, effectiveFrom: today(2), archived: false, amountGross: '100.00' },
        { id: inForceId, effectiveFrom: today(3), archived: false, amountGross: '120.00' },
      ],
      { attachedAt: today(2) },
    );

    await capture(parcel);
    const itemABefore = await readItemSnapshot(parcel.itemA);
    expect(itemABefore.snapshotCostProfileVersionIds).toEqual(
      sorted([...cogsVersionIds, inForceId]),
    );

    // Nothing changed: the next capture the same day re-derives the same pinned version
    // and writes nothing.
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 0 });
    const itemAAfter = await readItemSnapshot(parcel.itemA);
    expect(itemAAfter).toEqual(itemABefore);
    expect(itemAAfter.snapshotCostProfileVersionIds).not.toContain(firstId);
  });

  it('a final order keeps its filled cost list through an added and a replaced link of its day; its non-final twin follows them', async () => {
    // An order from two days ago whose day the day-close pass has made final.
    const parcel = await seedSnapshotParcel({ sellerInputsFinalAt: SELLER_INPUTS_FINAL_AT });
    const orderDate = new Date(Date.now() - 2 * DAY_MS);
    await setOrderDate(parcel, orderDate);
    const onOrderDay = new Date(costDecisionTime(orderDate).getTime() - HOUR_MS);
    // Positive control: the same items on the same variants, seller inputs not final.
    const twin = await seedOrderTwin(parcel, { sellerInputsFinalAt: null });
    await capture(parcel);
    await capture(twin);
    const itemABefore = await readItemSnapshot(parcel.itemA);
    const twinABefore = await readItemSnapshot(twin.itemA);
    expect(itemABefore.snapshotCostProfileVersionIds).toHaveLength(1);

    // Added: a second profile linked on the order's day does not reach the final order.
    await attachCostProfile({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      productVariantId: parcel.variantA,
      amountGross: '12.00',
      vatRate: '20',
      attachedAt: onOrderDay,
    });
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 0 });
    expect(await readItemSnapshot(parcel.itemA)).toEqual(itemABefore);
    await expect(capture(twin)).resolves.toEqual({ orderWritten: false, itemsWritten: 1 });
    expect(await readItemSnapshot(twin.itemA)).toEqual({
      ...twinABefore,
      snapshotCostProfileVersionIds: await linkedCostVersionIds(
        parcel.organizationId,
        parcel.variantA,
      ),
    });

    // Replaced on the order's day: neither does a replacement of every link.
    await prisma.productVariantCostProfile.deleteMany({
      where: { organizationId: parcel.organizationId, productVariantId: parcel.variantA },
    });
    await backdateSellerInputHistory(parcel.organizationId, onOrderDay);
    await attachCostProfile({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      productVariantId: parcel.variantA,
      amountGross: '40.00',
      vatRate: '20',
      attachedAt: onOrderDay,
    });
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 0 });
    expect(await readItemSnapshot(parcel.itemA)).toEqual(itemABefore);
    await expect(capture(twin)).resolves.toEqual({ orderWritten: false, itemsWritten: 1 });
    expect(await readItemSnapshot(twin.itemA)).toEqual({
      ...twinABefore,
      snapshotCostProfileVersionIds: await linkedCostVersionIds(
        parcel.organizationId,
        parcel.variantA,
      ),
    });
  });

  it('captures a variant without any desi (no correction, no Trendyol desi) as an empty desi with no source, never filled on a final order', async () => {
    const parcel = await seedSnapshotParcel({ sellerInputsFinalAt: SELLER_INPUTS_FINAL_AT });
    // Trendyol sent no desi for either variant and the seller corrected neither.
    await prisma.productVariant.update({
      where: { id: parcel.variantA },
      data: { dimensionalWeightOverride: null, syncedDimensionalWeight: null },
    });
    await prisma.productVariant.update({
      where: { id: parcel.variantB },
      data: { syncedDimensionalWeight: null },
    });
    // Fixture setup, not history: neither variant had a desi on the order's day.
    await clearSellerInputHistory(parcel.organizationId);
    // Positive control for the guard below: the same items on an order whose seller
    // inputs still follow its day, captured (without a desi) before the later entries.
    const twin = await seedOrderTwin(parcel, { sellerInputsFinalAt: null });

    await expect(capture(parcel)).resolves.toEqual({ orderWritten: true, itemsWritten: 2 });
    await expect(capture(twin)).resolves.toEqual({ orderWritten: true, itemsWritten: 2 });
    for (const itemId of [parcel.itemA, parcel.itemB, twin.itemA, twin.itemB]) {
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
    // not reach the final order's capture, even when the history places it on the
    // order's day (the day-end state then holds it): the item captured without a desi
    // stays empty.
    await prisma.productVariant.update({
      where: { id: parcel.variantA },
      data: { dimensionalWeightOverride: '2.50' },
    });
    await prisma.productVariant.update({
      where: { id: parcel.variantB },
      data: { syncedDimensionalWeight: '4.00' },
    });
    await backdateSellerInputHistory(parcel.organizationId, laterOnOrderDay(1));
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 0 });
    for (const itemId of [parcel.itemA, parcel.itemB]) {
      const item = await readItemSnapshot(itemId);
      expect(item.snapshotUnitDesi).toBeNull();
      expect(item.snapshotDesiSource).toBeNull();
    }

    // The non-final twin does take both entries stamped on the order's day.
    await expect(capture(twin)).resolves.toEqual({ orderWritten: false, itemsWritten: 2 });
    const twinA = await readItemSnapshot(twin.itemA);
    expect(twinA.snapshotUnitDesi?.toString()).toBe('2.5');
    expect(twinA.snapshotDesiSource).toBe(SnapshotDesiSource.OVERRIDE);
    const twinB = await readItemSnapshot(twin.itemB);
    expect(twinB.snapshotUnitDesi?.toString()).toBe('4');
    expect(twinB.snapshotDesiSource).toBe(SnapshotDesiSource.SYNCED);
  });

  it('keeps a stored synced desi of 0 as a known desi: captured as 0 from the synced value and never filled later on a final order', async () => {
    const parcel = await seedSnapshotParcel({ sellerInputsFinalAt: SELLER_INPUTS_FINAL_AT });
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
    // Fixture setup, not history: both variants had that desi on the order's day.
    await clearSellerInputHistory(parcel.organizationId);
    // Positive control for the guard below: the same items on an order whose seller
    // inputs still follow its day, captured (with the 0) before the later entries.
    const twin = await seedOrderTwin(parcel, { sellerInputsFinalAt: null });
    await capture(parcel);
    await expect(capture(twin)).resolves.toEqual({ orderWritten: true, itemsWritten: 2 });
    const itemABefore = await readItemSnapshot(parcel.itemA);
    const itemBBefore = await readItemSnapshot(parcel.itemB);
    for (const item of [
      itemABefore,
      itemBBefore,
      await readItemSnapshot(twin.itemA),
      await readItemSnapshot(twin.itemB),
    ]) {
      expect(item.snapshotUnitDesi?.toString()).toBe('0');
      expect(item.snapshotDesiSource).toBe(SnapshotDesiSource.SYNCED);
    }

    // A later seller correction and a later Trendyol desi do not reach the final
    // order's capture, even when the history places them on the order's day: 0 is a
    // known desi, not a gap to fill.
    await prisma.productVariant.update({
      where: { id: parcel.variantA },
      data: { dimensionalWeightOverride: '2.50' },
    });
    await prisma.productVariant.update({
      where: { id: parcel.variantB },
      data: { syncedDimensionalWeight: '4.00' },
    });
    await backdateSellerInputHistory(parcel.organizationId, laterOnOrderDay(1));
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 0 });
    expect(await readItemSnapshot(parcel.itemA)).toEqual(itemABefore);
    expect(await readItemSnapshot(parcel.itemB)).toEqual(itemBBefore);

    // The non-final twin does take both entries stamped on the order's day.
    await expect(capture(twin)).resolves.toEqual({ orderWritten: false, itemsWritten: 2 });
    const twinA = await readItemSnapshot(twin.itemA);
    expect(twinA.snapshotUnitDesi?.toString()).toBe('2.5');
    expect(twinA.snapshotDesiSource).toBe(SnapshotDesiSource.OVERRIDE);
    const twinB = await readItemSnapshot(twin.itemB);
    expect(twinB.snapshotUnitDesi?.toString()).toBe('4');
    expect(twinB.snapshotDesiSource).toBe(SnapshotDesiSource.SYNCED);
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

  it("pins the cost version in force at the order's day end, not the latest", async () => {
    const parcel = await seedSnapshotParcel();
    // The melontik COGS profile has a single version, effective (and linked) since
    // COST_FIXTURE_EPOCH: it is the version at the order's day end.
    const cogsVersionIds = await linkedCostVersionIds(parcel.organizationId, parcel.variantA);
    expect(cogsVersionIds).toHaveLength(1);
    const cogsVersions = await prisma.costProfileVersion.findMany({
      where: { id: { in: cogsVersionIds } },
      select: { effectiveFrom: true },
    });
    expect(
      cogsVersions.every(
        (version) => version.effectiveFrom.getTime() <= MELONTIK.orderDate.getTime(),
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

  it('skips a cost profile whose version in force at the day end is archived', async () => {
    const parcel = await seedSnapshotParcel();
    const cogsVersionIds = await linkedCostVersionIds(parcel.organizationId, parcel.variantA);
    expect(cogsVersionIds).toHaveLength(1);
    // Archived at the day end, restored after it: the version in force is archived.
    const archivedInForceId = randomUUID();
    const restoredLaterId = randomUUID();
    await attachCostProfileVersions(parcel, parcel.variantA, [
      { id: archivedInForceId, effectiveFrom: BEFORE_ORDER_DATE, archived: true },
      { id: restoredLaterId, effectiveFrom: AFTER_ORDER_DATE, archived: false },
    ]);
    // Live at the day end, archived after it: the version in force is usable.
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

  it("a cost linked after the order's business day does not fill an empty cost list", async () => {
    const parcel = await seedSnapshotParcel();
    // Item A's variant keeps only a profile archived before the order: no cost in force.
    await prisma.productVariantCostProfile.deleteMany({
      where: { organizationId: parcel.organizationId, productVariantId: parcel.variantA },
    });
    // Fixture setup, not history: the removed link was not on the variant that day.
    await clearSellerInputHistory(parcel.organizationId);
    await attachCostProfileVersions(parcel, parcel.variantA, [
      { id: randomUUID(), effectiveFrom: COST_FIXTURE_EPOCH, archived: false },
      { id: randomUUID(), effectiveFrom: BEFORE_ORDER_DATE, archived: true },
    ]);
    await capture(parcel);
    const itemABefore = await readItemSnapshot(parcel.itemA);
    expect(itemABefore.snapshotCostProfileVersionIds).toEqual([]);

    // The seller attaches a new profile now, long after the order's day ended: the
    // order's cost was decided at its day end, so the late link never reaches it.
    await attachCostProfile({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      productVariantId: parcel.variantA,
      amountGross: '12.00',
      vatRate: '20',
      attachedAt: new Date(),
    });
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 0 });
    expect(await readItemSnapshot(parcel.itemA)).toEqual(itemABefore);
  });

  it('a past-day capture ignores a link attached after the day end', async () => {
    const parcel = await seedSnapshotParcel();
    const cogsVersionIds = await linkedCostVersionIds(parcel.organizationId, parcel.variantA);
    expect(cogsVersionIds).toHaveLength(1);
    // Attached exactly at the day end: still counts (the boundary is inclusive).
    const atDayEndId = randomUUID();
    await attachCostProfileVersions(
      parcel,
      parcel.variantA,
      [{ id: atDayEndId, effectiveFrom: COST_FIXTURE_EPOCH, archived: false }],
      { attachedAt: ORDER_DAY_END },
    );
    // Attached after the day end: too late for this order.
    const afterDayEndId = randomUUID();
    await attachCostProfileVersions(
      parcel,
      parcel.variantA,
      [{ id: afterDayEndId, effectiveFrom: COST_FIXTURE_EPOCH, archived: false }],
      { attachedAt: AFTER_ORDER_DAY_END },
    );

    await capture(parcel);

    const itemA = await readItemSnapshot(parcel.itemA);
    expect(itemA.snapshotCostProfileVersionIds).toEqual(sorted([...cogsVersionIds, atDayEndId]));
  });

  // Same-day edit window (plan PR-1, P1-08): a capture reads the seller inputs in
  // force at the order's day end, rebuilt from the history logs, so a write stamped
  // after that day end does not reach a first capture of the order.
  it("a past-day first capture pins a link detached after the order's day end", async () => {
    const parcel = await seedSnapshotParcel();
    await setOrderDate(parcel, new Date(Date.now() - DAY_MS));
    const cogsVersionIds = await linkedCostVersionIds(parcel.organizationId, parcel.variantA);
    expect(cogsVersionIds).toHaveLength(1);
    // Detached now, after yesterday's day end.
    await prisma.productVariantCostProfile.deleteMany({
      where: { organizationId: parcel.organizationId, productVariantId: parcel.variantA },
    });

    await capture(parcel);

    const itemA = await readItemSnapshot(parcel.itemA);
    expect(itemA.snapshotCostProfileVersionIds).toEqual(cogsVersionIds);
  });

  it("a past-day first capture takes the desi in force at the order's day end", async () => {
    const parcel = await seedSnapshotParcel();
    await setOrderDate(parcel, new Date(Date.now() - DAY_MS));
    // Changed now, after yesterday's day end: item A's override, item B's synced desi.
    await prisma.productVariant.update({
      where: { id: parcel.variantA },
      data: { dimensionalWeightOverride: '7.00' },
    });
    await prisma.productVariant.update({
      where: { id: parcel.variantB },
      data: { syncedDimensionalWeight: '4.00' },
    });

    await capture(parcel);

    const itemA = await readItemSnapshot(parcel.itemA);
    expect(itemA.snapshotUnitDesi?.toString()).toBe('3.5');
    expect(itemA.snapshotDesiSource).toBe(SnapshotDesiSource.OVERRIDE);
    const itemB = await readItemSnapshot(parcel.itemB);
    expect(itemB.snapshotUnitDesi?.toString()).toBe('1');
    expect(itemB.snapshotDesiSource).toBe(SnapshotDesiSource.SYNCED);
  });

  it('a profile archived before the day end is not pinned, archived after it is pinned', async () => {
    const parcel = await seedSnapshotParcel();
    const cogsVersionIds = await linkedCostVersionIds(parcel.organizationId, parcel.variantA);
    expect(cogsVersionIds).toHaveLength(1);
    // Live at the order instant, archived later the same day: not in force at the day end.
    const archivedSameDayLiveId = randomUUID();
    await attachCostProfileVersions(parcel, parcel.variantA, [
      { id: archivedSameDayLiveId, effectiveFrom: COST_FIXTURE_EPOCH, archived: false },
      { id: randomUUID(), effectiveFrom: laterOnOrderDay(1), archived: true },
    ]);
    // Live at the order instant, archived after the day ended: in force at the day end.
    const archivedAfterDayLiveId = randomUUID();
    await attachCostProfileVersions(parcel, parcel.variantA, [
      { id: archivedAfterDayLiveId, effectiveFrom: COST_FIXTURE_EPOCH, archived: false },
      { id: randomUUID(), effectiveFrom: AFTER_ORDER_DAY_END, archived: true },
    ]);

    await capture(parcel);

    const itemA = await readItemSnapshot(parcel.itemA);
    expect(itemA.snapshotCostProfileVersionIds).toEqual(
      sorted([...cogsVersionIds, archivedAfterDayLiveId]),
    );
    expect(itemA.snapshotCostProfileVersionIds).not.toContain(archivedSameDayLiveId);
  });

  it("today's empty list is filled by a cost attached the same day", async () => {
    const parcel = await seedSnapshotParcel();
    // An order placed now, whose variant has no cost yet.
    const orderDate = new Date();
    await setOrderDate(parcel, orderDate);
    await prisma.productVariantCostProfile.deleteMany({
      where: { organizationId: parcel.organizationId, productVariantId: parcel.variantA },
    });
    await capture(parcel);
    const itemABefore = await readItemSnapshot(parcel.itemA);
    expect(itemABefore.snapshotCostProfileVersionIds).toEqual([]);

    // The seller enters the cost the same day (stamped at the order instant, so the
    // test cannot straddle midnight).
    await attachCostProfile({
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      productVariantId: parcel.variantA,
      amountGross: '12.00',
      vatRate: '20',
      attachedAt: orderDate,
    });
    await expect(capture(parcel)).resolves.toEqual({ orderWritten: false, itemsWritten: 1 });
    const itemAAfter = await readItemSnapshot(parcel.itemA);
    expect(itemAAfter.snapshotCostProfileVersionIds).toHaveLength(1);
    expect(itemAAfter.snapshotCostProfileVersionIds).toEqual(
      await linkedCostVersionIds(parcel.organizationId, parcel.variantA),
    );
    expect(itemAAfter.profitSnapshotAt).toEqual(itemABefore.profitSnapshotAt);
  });

  it('a profile archived then restored before capture is pinned with a non-archived version', async () => {
    const parcel = await seedSnapshotParcel();
    const cogsVersionIds = await linkedCostVersionIds(parcel.organizationId, parcel.variantA);
    expect(cogsVersionIds).toHaveLength(1);
    // Archived before the order, restored later the same day: the restore version is
    // the one in force at the day end, so it prices the order.
    const restoredId = randomUUID();
    await attachCostProfileVersions(parcel, parcel.variantA, [
      { id: randomUUID(), effectiveFrom: COST_FIXTURE_EPOCH, archived: false },
      { id: randomUUID(), effectiveFrom: BEFORE_ORDER_DATE, archived: true },
      { id: restoredId, effectiveFrom: laterOnOrderDay(1), archived: false },
    ]);
    // Live at the order instant, archived after it and restored before the day end:
    // the restore version prices the order, not the one live at the order instant.
    const liveAtOrderId = randomUUID();
    const restoredAfterOrderId = randomUUID();
    await attachCostProfileVersions(parcel, parcel.variantA, [
      { id: liveAtOrderId, effectiveFrom: COST_FIXTURE_EPOCH, archived: false },
      { id: randomUUID(), effectiveFrom: laterOnOrderDay(1), archived: true },
      { id: restoredAfterOrderId, effectiveFrom: laterOnOrderDay(2), archived: false },
    ]);

    await capture(parcel);

    const itemA = await readItemSnapshot(parcel.itemA);
    expect(itemA.snapshotCostProfileVersionIds).toEqual(
      sorted([...cogsVersionIds, restoredId, restoredAfterOrderId]),
    );
    expect(itemA.snapshotCostProfileVersionIds).not.toContain(liveAtOrderId);
  });

  it('the day-end version is pinned when the amount was edited later the same day', async () => {
    const parcel = await seedSnapshotParcel();
    const cogsVersionIds = await linkedCostVersionIds(parcel.organizationId, parcel.variantA);
    // 100 at the order instant; the seller edits it to 120 later the same day (Berkin
    // 2026-11-23: the cost in force at the end of the order's business day).
    const orderTimeId = randomUUID();
    const editedId = randomUUID();
    await attachCostProfileVersions(parcel, parcel.variantA, [
      {
        id: orderTimeId,
        effectiveFrom: COST_FIXTURE_EPOCH,
        archived: false,
        amountGross: '100.00',
      },
      { id: editedId, effectiveFrom: laterOnOrderDay(1), archived: false, amountGross: '120.00' },
    ]);

    await capture(parcel);

    const itemA = await readItemSnapshot(parcel.itemA);
    expect(itemA.snapshotCostProfileVersionIds).toEqual(sorted([...cogsVersionIds, editedId]));
    expect(itemA.snapshotCostProfileVersionIds).not.toContain(orderTimeId);
  });

  it('a profile created after the order instant is pinned with its version in force at the day end', async () => {
    const parcel = await seedSnapshotParcel();
    const cogsVersionIds = await linkedCostVersionIds(parcel.organizationId, parcel.variantA);
    // The profile is created after the order instant (100) and edited to 120 before
    // the day end: the version in force at the decision time prices it, not the first
    // one.
    const firstId = randomUUID();
    const inForceId = randomUUID();
    await attachCostProfileVersions(
      parcel,
      parcel.variantA,
      [
        { id: firstId, effectiveFrom: laterOnOrderDay(1), archived: false, amountGross: '100.00' },
        {
          id: inForceId,
          effectiveFrom: laterOnOrderDay(2),
          archived: false,
          amountGross: '120.00',
        },
      ],
      { attachedAt: laterOnOrderDay(1) },
    );

    await capture(parcel);

    const itemA = await readItemSnapshot(parcel.itemA);
    expect(itemA.snapshotCostProfileVersionIds).toEqual(sorted([...cogsVersionIds, inForceId]));
    expect(itemA.snapshotCostProfileVersionIds).not.toContain(firstId);
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
