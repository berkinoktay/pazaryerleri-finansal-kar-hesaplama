// Order profit snapshot (plan PR-2, decisions 3 and 4): the undated product and
// seller inputs an order is priced with, copied onto the order and its items the
// first time the order enters the profit computation. Afterwards only missing parts
// are filled: an uncaptured order or item, an item whose variant was matched later,
// a carrier that was not recognised, an empty cost list, commission inputs none of
// which gives a rate. The desi is not filled: a captured desi (0 included) is known,
// and an item captured without one stays so. A known value is never overwritten with
// a live one. The events that change a filled value are the order's own cargo name
// changing (the carrier is recognised again), an item getting a variant that differs
// from the captured one (the item is captured again), and the cost-window rule:
// while the order's business day is open the seller may still enter or change its
// cost, so the cost list follows the variant's cost links until that day ends. A variant that drops to null (deleted from the
// catalogue) changes nothing. The order's capture time never moves after the first
// capture; an item's moves only with a fresh capture, never with a gap fill or a
// cost list update.
//
// Dated shared values (tariff versions, fee definitions, micro-export tiers) are not
// copied; the engine keeps reading them by the order date.

import type { Decimal } from 'decimal.js';
import type { Prisma } from '@pazarsync/db';
import { Platform, SnapshotDesiSource } from '@pazarsync/db/enums';
import { getBusinessDayRange, resolveProfitSettings } from '@pazarsync/utils';

import { compareText } from '../core/compare-text';
import { chooseCostVersion } from '../core/seller-costs/build-seller-cost-lines';
import {
  trendyolCategoryBrandKey,
  type TrendyolCommissionRules,
} from '../marketplaces/trendyol/trendyol-inputs';
import {
  loadActiveTrendyolCarriers,
  reportedProviderName,
  resolveOrderCarrier,
} from './load-trendyol-parcel';
import {
  dec,
  loadCommissionRulesForCategories,
  loadIdentifiedCostProfilesByVariant,
  type IdentifiedItemCostProfileInput,
} from './trendyol-reference-loaders';

/** What one capture call wrote: the order row and how many item rows. */
export interface OrderProfitSnapshotOutcome {
  readonly orderWritten: boolean;
  readonly itemsWritten: number;
}

const NOTHING_WRITTEN: OrderProfitSnapshotOutcome = { orderWritten: false, itemsWritten: 0 };

/** The order, the store's platform and the two store settings the snapshot copies, and every item with its variant and product. */
const SNAPSHOT_ORDER_INCLUDE = {
  store: { select: { platform: true, shippingTariffSource: true, profitSettings: true } },
  items: {
    include: {
      productVariant: {
        include: { product: { select: { categoryId: true, brandId: true } } },
      },
    },
  },
} as const satisfies Prisma.OrderInclude;

type SnapshotOrder = Prisma.OrderGetPayload<{ include: typeof SNAPSHOT_ORDER_INCLUDE }>;
type SnapshotOrderItem = SnapshotOrder['items'][number];
/** An item's live variant with its product's category and brand. */
type LiveVariant = NonNullable<SnapshotOrderItem['productVariant']>;

/**
 * Captures the order's product/seller inputs once; afterwards fills only missing
 * parts, and keeps an item's cost list on its current cost links while the order's
 * business day is open. Never overwrites a known value with a live one. Writes
 * nothing and returns `{ orderWritten: false, itemsWritten: 0 }` when the order is
 * not this organization's, or its store is not a Trendyol store. Query count does
 * not depend on the item count; writes are at most one order update and one update
 * per written item.
 */
export async function captureOrderProfitSnapshot(
  tx: Prisma.TransactionClient,
  params: { readonly organizationId: string; readonly orderId: string },
): Promise<OrderProfitSnapshotOutcome> {
  const { organizationId, orderId } = params;
  const now = new Date();

  const order = await tx.order.findFirst({
    where: { id: orderId, organizationId },
    include: SNAPSHOT_ORDER_INCLUDE,
  });
  if (order === null) {
    return NOTHING_WRITTEN;
  }
  // The snapshot knows only the inputs of the Trendyol engine for now (Trendyol
  // carriers, Trendyol commission rules); another platform's order is left alone.
  if (order.store.platform !== Platform.TRENDYOL) {
    return NOTHING_WRITTEN;
  }

  const orderData = await orderSnapshotData(tx, order, now);
  if (orderData !== null) {
    await tx.order.update({ where: { id: order.id, organizationId }, data: orderData });
  }

  const itemsWritten = await captureItems(tx, {
    organizationId,
    orderDate: order.orderDate,
    items: order.items,
    now,
  });

  return { orderWritten: orderData !== null, itemsWritten };
}

// --- Order --------------------------------------------------------------------

/**
 * The carrier recognised from the order's own cargo name, or null. The same read
 * as `loadTrendyolParcel` (`loadActiveTrendyolCarriers`, platform-global reference
 * data, no tenant filter by design). A null or blank name is never recognised, so
 * it skips the read.
 */
async function recogniseCarrierId(
  tx: Prisma.TransactionClient,
  cargoProviderName: string | null,
): Promise<string | null> {
  if (reportedProviderName(cargoProviderName) === null) {
    return null;
  }
  const activeCarriers = await loadActiveTrendyolCarriers(tx);
  return resolveOrderCarrier(cargoProviderName, activeCarriers)?.id ?? null;
}

/** The order-level snapshot columns to write, or null when nothing is missing. */
async function orderSnapshotData(
  tx: Prisma.TransactionClient,
  order: SnapshotOrder,
  now: Date,
): Promise<Prisma.OrderUncheckedUpdateInput | null> {
  if (order.profitSnapshotAt === null) {
    // The settings flags are normally written when the order is created; a filled
    // flag is kept, only a null one takes the store's current setting.
    const storeSettings = resolveProfitSettings(order.store.profitSettings);
    return {
      snapshotCarrierId: await recogniseCarrierId(tx, order.cargoProviderName),
      snapshotCargoProviderName: order.cargoProviderName,
      snapshotShippingTariffSource: order.store.shippingTariffSource,
      snapshotIncludeStopaj: order.snapshotIncludeStopaj ?? storeSettings.includeStopaj,
      snapshotIncludeNegativeNetVat:
        order.snapshotIncludeNegativeNetVat ?? storeSettings.includeNegativeNetVat,
      profitSnapshotAt: now,
    };
  }

  // The order's own cargo name changed since the capture (Trendyol's data, not a
  // mapping edit): the carrier is recognised again from the new name.
  if (order.cargoProviderName !== order.snapshotCargoProviderName) {
    return {
      snapshotCarrierId: await recogniseCarrierId(tx, order.cargoProviderName),
      snapshotCargoProviderName: order.cargoProviderName,
    };
  }

  // Gap fill: the same name was not recognised at the capture; it may be now. A
  // recognised carrier is never re-resolved, so a later mapping edit cannot move it.
  if (order.snapshotCarrierId === null) {
    const carrierId = await recogniseCarrierId(tx, order.cargoProviderName);
    return carrierId === null ? null : { snapshotCarrierId: carrierId };
  }

  return null;
}

// --- Items --------------------------------------------------------------------

/**
 * True when the item was never captured, or it now has a variant that differs from
 * the captured one (e.g. the barcode was matched to a variant after intake): the
 * whole item is captured (again) and its capture time moves. A variant that dropped
 * to null (deleted from the catalogue) is not a change: the captured values stay.
 */
function needsFullCapture(item: SnapshotOrderItem): boolean {
  if (item.profitSnapshotAt === null) {
    return true;
  }
  return item.productVariantId !== null && item.productVariantId !== item.snapshotProductVariantId;
}

/**
 * True when the stored cost list is empty. The column is nullable in the database
 * although Prisma reads it as a list, so a null counts as empty too.
 */
function isEmptyCostList(ids: readonly string[] | null): boolean {
  return ids === null || ids.length === 0;
}

/**
 * True while the order's business day (Europe/Istanbul, the day of the cost-window
 * rule) has not ended at `now`: the seller may still enter or change the order's
 * cost, so a captured cost list keeps following the variant's cost links.
 */
function isOrderBusinessDayOpen(orderDate: Date, now: Date): boolean {
  return now.getTime() < getBusinessDayRange(orderDate).end.getTime();
}

/**
 * True when a captured item's cost list is computed again from its variant's cost
 * links: on every call while the order's business day is open, afterwards only while
 * the list is empty (a cost linked later fills it; a filled list is frozen).
 */
function needsCostListRefresh(item: SnapshotOrderItem, dayOpen: boolean): boolean {
  return dayOpen || isEmptyCostList(item.snapshotCostProfileVersionIds);
}

/** True when a rate input gives a rate: Trendyol's null or zero rate means "not sent". */
function givesRate(ratePct: Prisma.Decimal | null): boolean {
  return ratePct !== null && dec(ratePct).gt(0);
}

/**
 * True when none of a captured item's commission inputs gives a rate: no positive
 * synced rate and neither category rule rate. Such an item takes the live values that
 * are filled now; an item with any rate keeps every commission input as captured.
 */
function lacksCommissionRate(item: SnapshotOrderItem): boolean {
  return (
    !givesRate(item.snapshotSyncedCommissionRatePct) &&
    item.snapshotCategoryRatePct === null &&
    item.snapshotCategoryBrandRatePct === null
  );
}

/**
 * The category the item's commission rules are resolved for: the captured one, or
 * the live product's when none was captured (the same id a commission fill writes).
 */
function commissionCategoryId(item: SnapshotOrderItem): bigint | null {
  return item.snapshotCategoryId ?? item.productVariant?.product.categoryId ?? null;
}

/**
 * Captures or fills every item that needs it. Commission rules and cost profiles
 * are read once for all such items; each written item gets one update.
 */
async function captureItems(
  tx: Prisma.TransactionClient,
  params: {
    readonly organizationId: string;
    readonly orderDate: Date;
    readonly items: readonly SnapshotOrderItem[];
    readonly now: Date;
  },
): Promise<number> {
  const { organizationId, orderDate, items, now } = params;
  const dayOpen = isOrderBusinessDayOpen(orderDate, now);
  const captureList = items.filter(needsFullCapture);
  // Captured items whose variant is still in the catalogue: the only ones a gap fill
  // or a cost list update reads live values for.
  const fillList = items.filter((item) => !needsFullCapture(item) && item.productVariant !== null);
  const costFillList = fillList.filter((item) => needsCostListRefresh(item, dayOpen));
  const commissionFillList = fillList.filter(lacksCommissionRate);

  // Platform-global reference data: the category ids are the only scope.
  const rules = await loadCommissionRulesForCategories(tx, {
    categoryIds: [
      ...captureList.map((item) => item.productVariant?.product.categoryId ?? null),
      ...commissionFillList.map(commissionCategoryId),
    ].filter((categoryId): categoryId is bigint => categoryId !== null),
  });
  const costsByVariant = await loadIdentifiedCostProfilesByVariant(tx, {
    organizationId,
    variantIds: [...captureList, ...costFillList]
      .map((item) => item.productVariantId)
      .filter((variantId): variantId is string => variantId !== null),
  });

  const writes: { readonly id: string; readonly data: Prisma.OrderItemUncheckedUpdateInput }[] = [];
  for (const item of captureList) {
    writes.push({
      id: item.id,
      data: itemCaptureData(item, { rules, costsByVariant, orderDate, now }),
    });
  }
  for (const item of fillList) {
    const data = itemFillData(item, { rules, costsByVariant, orderDate, dayOpen });
    if (data !== null) {
      writes.push({ id: item.id, data });
    }
  }

  // Item rows are updated in ascending id order: one fixed global order, so another
  // writer of these order_items rows that takes them in id order too can never lock
  // them in the opposite order (no deadlock between the two transactions).
  writes.sort((a, b) => compareText(a.id, b.id));
  for (const write of writes) {
    await tx.orderItem.update({ where: { id: write.id, organizationId }, data: write.data });
  }
  return writes.length;
}

/**
 * The missing parts of a captured item, filled from its live variant and product, as
 * one update, or null when nothing changes: the cost list (see
 * `needsCostListRefresh`) and commission inputs none of which gives a rate. Its
 * capture time stays. The desi is never filled: a captured desi (0 included) is a
 * known value, and an item captured without one belongs to an order the desi gate
 * keeps out of profit.
 */
function itemFillData(
  item: SnapshotOrderItem,
  reference: {
    readonly rules: TrendyolCommissionRules;
    readonly costsByVariant: ReadonlyMap<string, readonly IdentifiedItemCostProfileInput[]>;
    readonly orderDate: Date;
    readonly dayOpen: boolean;
  },
): Prisma.OrderItemUncheckedUpdateInput | null {
  const variant = item.productVariant;
  if (variant === null) {
    return null;
  }
  const data: Prisma.OrderItemUncheckedUpdateInput = {
    ...costListFillData(item, variant.id, reference),
    ...commissionFillData(item, variant, reference.rules),
  };
  return Object.keys(data).length === 0 ? null : data;
}

/** The item's cost list computed again from its variant's links, when it needs it and differs from the stored one. */
function costListFillData(
  item: SnapshotOrderItem,
  variantId: string,
  reference: {
    readonly costsByVariant: ReadonlyMap<string, readonly IdentifiedItemCostProfileInput[]>;
    readonly orderDate: Date;
    readonly dayOpen: boolean;
  },
): Prisma.OrderItemUncheckedUpdateInput {
  if (!needsCostListRefresh(item, reference.dayOpen)) {
    return {};
  }
  const stored = item.snapshotCostProfileVersionIds ?? [];
  const current = pinnedCostVersionIds(
    reference.costsByVariant.get(variantId),
    reference.orderDate,
  );
  const unchanged =
    stored.length === current.length && stored.every((id, index) => id === current[index]);
  return unchanged ? {} : { snapshotCostProfileVersionIds: current };
}

/**
 * The item's commission inputs, when none of the captured ones gives a rate: of the
 * live synced rate, category, brand and the two rule rates, those that are filled
 * now. A captured category or brand stays and the rule rates are resolved for it; a
 * missing one takes the live product's. An item with any rate gets nothing.
 */
function commissionFillData(
  item: SnapshotOrderItem,
  variant: LiveVariant,
  rules: TrendyolCommissionRules,
): Prisma.OrderItemUncheckedUpdateInput {
  if (!lacksCommissionRate(item)) {
    return {};
  }
  const categoryId = commissionCategoryId(item);
  const brandId = item.snapshotBrandId ?? variant.product.brandId;
  const rates = ruleRates(rules, categoryId, brandId);
  return {
    ...(givesRate(variant.syncedCommissionRate) && {
      snapshotSyncedCommissionRatePct: variant.syncedCommissionRate,
    }),
    ...(item.snapshotCategoryId === null &&
      categoryId !== null && { snapshotCategoryId: categoryId }),
    ...(item.snapshotBrandId === null && brandId !== null && { snapshotBrandId: brandId }),
    ...(rates.categoryRatePct !== null && { snapshotCategoryRatePct: rates.categoryRatePct }),
    ...(rates.categoryBrandRatePct !== null && {
      snapshotCategoryBrandRatePct: rates.categoryBrandRatePct,
    }),
  };
}

/** The category rule rate and the category+brand rule rate for a category and brand, each null when no rule covers it. */
function ruleRates(
  rules: TrendyolCommissionRules,
  categoryId: bigint | null,
  brandId: bigint | null,
): { readonly categoryRatePct: Decimal | null; readonly categoryBrandRatePct: Decimal | null } {
  if (categoryId === null) {
    return { categoryRatePct: null, categoryBrandRatePct: null };
  }
  const categoryKey = categoryId.toString();
  return {
    categoryRatePct: rules.categoryRatePct.get(categoryKey) ?? null,
    categoryBrandRatePct:
      brandId === null
        ? null
        : (rules.categoryBrandRatePct.get(
            trendyolCategoryBrandKey(categoryKey, brandId.toString()),
          ) ?? null),
  };
}

/**
 * The item's desi and where it came from, as in the engine: the seller's correction
 * wins over the synced value. With neither (Trendyol sent no desi and the seller
 * entered none) both columns stay empty. A desi of 0 is a real desi.
 */
function desiCaptureData(
  variant: LiveVariant,
): Pick<Prisma.OrderItemUncheckedUpdateInput, 'snapshotUnitDesi' | 'snapshotDesiSource'> {
  const override = variant.dimensionalWeightOverride;
  if (override !== null) {
    return { snapshotUnitDesi: override, snapshotDesiSource: SnapshotDesiSource.OVERRIDE };
  }
  const synced = variant.syncedDimensionalWeight;
  if (synced !== null) {
    return { snapshotUnitDesi: synced, snapshotDesiSource: SnapshotDesiSource.SYNCED };
  }
  return { snapshotUnitDesi: null, snapshotDesiSource: null };
}

/**
 * Every item snapshot column, taken from the item's current variant, product,
 * commission rules and cost links. An item without a variant is captured with these
 * inputs empty and an empty cost list.
 */
function itemCaptureData(
  item: SnapshotOrderItem,
  reference: {
    readonly rules: TrendyolCommissionRules;
    readonly costsByVariant: ReadonlyMap<string, readonly IdentifiedItemCostProfileInput[]>;
    readonly orderDate: Date;
    readonly now: Date;
  },
): Prisma.OrderItemUncheckedUpdateInput {
  const { rules, costsByVariant, orderDate, now } = reference;
  const variant = item.productVariant;
  if (variant === null) {
    return {
      snapshotProductVariantId: item.productVariantId,
      snapshotUnitDesi: null,
      snapshotDesiSource: null,
      snapshotIsDigital: null,
      snapshotCategoryId: null,
      snapshotBrandId: null,
      snapshotSyncedCommissionRatePct: null,
      snapshotCategoryRatePct: null,
      snapshotCategoryBrandRatePct: null,
      snapshotCostProfileVersionIds: [],
      profitSnapshotAt: now,
    };
  }

  const { categoryId, brandId } = variant.product;
  const rates = ruleRates(rules, categoryId, brandId);
  return {
    snapshotProductVariantId: item.productVariantId,
    ...desiCaptureData(variant),
    snapshotIsDigital: variant.isDigital,
    snapshotCategoryId: categoryId,
    snapshotBrandId: brandId,
    snapshotSyncedCommissionRatePct: variant.syncedCommissionRate,
    snapshotCategoryRatePct: rates.categoryRatePct,
    snapshotCategoryBrandRatePct: rates.categoryBrandRatePct,
    snapshotCostProfileVersionIds: pinnedCostVersionIds(costsByVariant.get(variant.id), orderDate),
    profitSnapshotAt: now,
  };
}

/**
 * The ids of the cost profile versions the engine would price the item with: per
 * linked profile, the version `chooseCostVersion` picks at the order date. A profile
 * whose chosen version is archived contributes nothing, as in the engine's cost
 * module; so does a profile without versions (the loader already drops those).
 * Sorted ascending: the link query has no order, and a stored list must not depend
 * on it.
 */
function pinnedCostVersionIds(
  profiles: readonly IdentifiedItemCostProfileInput[] | undefined,
  orderDate: Date,
): string[] {
  const ids: string[] = [];
  for (const profile of profiles ?? []) {
    if (profile.versions.length === 0) continue;
    const version = chooseCostVersion(profile.versions, orderDate);
    if (version.archivedAt !== null) continue;
    ids.push(version.id);
  }
  return ids.sort(compareText);
}
