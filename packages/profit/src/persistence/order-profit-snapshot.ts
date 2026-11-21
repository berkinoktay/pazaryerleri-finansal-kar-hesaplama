// Order profit snapshot (plan PR-2, decisions 3 and 4): the undated product and
// seller inputs an order is priced with, copied onto the order and its items the
// first time the order enters the profit computation. Afterwards only missing parts
// are filled: an uncaptured order or item, an item whose variant was matched later,
// a carrier that was not recognised, an empty cost list. A filled value is never
// overwritten with a live one. The only events that change a filled value are the
// order's own cargo name changing (the carrier is recognised again) and an item
// getting a variant that differs from the captured one (the item is captured
// again). A variant that drops to null (deleted from the catalogue) changes
// nothing. The order's capture time never moves after the first capture; an
// item's moves only with a fresh capture, never with a gap fill.
//
// Dated shared values (tariff versions, fee definitions, micro-export tiers) are not
// copied; the engine keeps reading them by the order date.

import type { Prisma } from '@pazarsync/db';
import { Platform, SnapshotDesiSource } from '@pazarsync/db/enums';
import { resolveProfitSettings } from '@pazarsync/utils';

import { compareText } from '../core/compare-text';
import { chooseCostVersion } from '../core/seller-costs/build-seller-cost-lines';
import {
  trendyolCategoryBrandKey,
  type TrendyolCommissionRules,
} from '../marketplaces/trendyol/trendyol-inputs';
import { reportedProviderName, resolveOrderCarrier } from './load-trendyol-parcel';
import {
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

/**
 * Captures the order's product/seller inputs once; afterwards fills only missing
 * parts. Never overwrites a filled value with a live one. Writes nothing and
 * returns `{ orderWritten: false, itemsWritten: 0 }` when the order is not this
 * organization's, or its store is not a Trendyol store. Query count does not
 * depend on the item count; writes are at most one order update and one update
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
 * as `loadTrendyolParcel`: active Trendyol carriers are a small platform-global
 * reference table shared across every organization, so this read carries no
 * tenant filter by design. A null or blank name is never recognised, so it skips
 * the read.
 */
async function recogniseCarrierId(
  tx: Prisma.TransactionClient,
  cargoProviderName: string | null,
): Promise<string | null> {
  if (reportedProviderName(cargoProviderName) === null) {
    return null;
  }
  const activeCarriers = await tx.shippingCarrier.findMany({
    where: { platform: Platform.TRENDYOL, active: true },
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    select: { id: true, code: true, displayName: true, orderCargoNames: true },
  });
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

/** True when a captured item has a variant but no pinned cost yet: only its cost list is retried. */
function needsCostFill(item: SnapshotOrderItem): boolean {
  return item.productVariantId !== null && isEmptyCostList(item.snapshotCostProfileVersionIds);
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
  const captureList = items.filter(needsFullCapture);
  const fillList = items.filter((item) => !needsFullCapture(item) && needsCostFill(item));
  if (captureList.length === 0 && fillList.length === 0) {
    return 0;
  }

  // Platform-global reference data: the category ids are the only scope.
  const rules = await loadCommissionRulesForCategories(tx, {
    categoryIds: captureList
      .map((item) => item.productVariant?.product.categoryId ?? null)
      .filter((categoryId): categoryId is bigint => categoryId !== null),
  });
  const costsByVariant = await loadIdentifiedCostProfilesByVariant(tx, {
    organizationId,
    variantIds: [...captureList, ...fillList]
      .map((item) => item.productVariantId)
      .filter((variantId): variantId is string => variantId !== null),
  });

  let written = 0;
  for (const item of captureList) {
    await tx.orderItem.update({
      where: { id: item.id, organizationId },
      data: itemCaptureData(item, { rules, costsByVariant, orderDate, now }),
    });
    written += 1;
  }
  for (const item of fillList) {
    if (item.productVariantId === null) continue;
    const costIds = pinnedCostVersionIds(costsByVariant.get(item.productVariantId), orderDate);
    if (costIds.length === 0) continue; // still no cost: nothing to fill
    await tx.orderItem.update({
      where: { id: item.id, organizationId },
      data: { snapshotCostProfileVersionIds: costIds },
    });
    written += 1;
  }
  return written;
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
  const override = variant.dimensionalWeightOverride;
  const categoryKey = categoryId?.toString() ?? null;
  return {
    snapshotProductVariantId: item.productVariantId,
    // The seller's desi correction wins over the synced value, as in the engine.
    snapshotUnitDesi: override ?? variant.syncedDimensionalWeight,
    snapshotDesiSource: override === null ? SnapshotDesiSource.SYNCED : SnapshotDesiSource.OVERRIDE,
    snapshotIsDigital: variant.isDigital,
    snapshotCategoryId: categoryId,
    snapshotBrandId: brandId,
    snapshotSyncedCommissionRatePct: variant.syncedCommissionRate,
    snapshotCategoryRatePct:
      categoryKey === null ? null : (rules.categoryRatePct.get(categoryKey) ?? null),
    snapshotCategoryBrandRatePct:
      categoryKey === null || brandId === null
        ? null
        : (rules.categoryBrandRatePct.get(
            trendyolCategoryBrandKey(categoryKey, brandId.toString()),
          ) ?? null),
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
