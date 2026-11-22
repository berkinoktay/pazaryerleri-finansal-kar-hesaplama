import { Decimal } from 'decimal.js';
import type { Prisma } from '@pazarsync/db';
import { FinanceRecordFamily, OrderStatus, Platform, ProfitIssueCode } from '@pazarsync/db/enums';
import { CLAIM_ITEM_STATUS_ACCEPTED } from '@pazarsync/marketplace';
import {
  getBusinessDate,
  resolveProfitSettings,
  type ResolvedProfitSettings,
} from '@pazarsync/utils';

import { compareText } from '../core/compare-text';
import { type AcceptedReturn, type ParcelItemSnapshot } from '../core/parcel-snapshot';
import { type ProfitIssue } from '../core/profit-issue';
import {
  type ItemCostInput,
  type ItemCostProfileInput,
} from '../core/seller-costs/build-seller-cost-lines';
import { type TrendyolEstimateInput } from '../marketplaces/trendyol/estimate-parcel';
import {
  isTrendyolTransactionType,
  TRENDYOL_PACKAGELESS_BINDABLE_TYPES,
  TRENDYOL_PAYMENT_ORDER_TRANSACTION_TYPE,
  type TrendyolCargoInvoiceItem,
  type TrendyolSettlementRecord,
} from '../marketplaces/trendyol/settlement-records';
import {
  trendyolCategoryBrandKey,
  type TrendyolCommissionRules,
  type TrendyolItemAttributes,
  type TrendyolOrderCarrierOutcome,
  type TrendyolParcelAttributes,
} from '../marketplaces/trendyol/trendyol-inputs';
import { ParcelNotFoundError, UnsupportedPlatformError } from './errors';
import { normalizeCargoProviderName } from './normalize-cargo-provider-name';
import {
  dec,
  decOrNull,
  loadCommissionRulesForCategories,
  loadCostProfilesByVariant,
  loadOrderFeeParams,
  loadPinnedCostProfilesByVersionId,
  loadShippingTariff,
} from './trendyol-reference-loaders';

const ZERO = new Decimal(0);

/**
 * Everything a parcel needs to be driven through the Phase 2A Trendyol module and
 * then written: the pure estimate input, the raw settlement + cargo records for the
 * mapper, the resolved profit settings, the exclusion flag, and the issues the loader
 * raised itself (the writer merges them in): a blocking REFERENCE_DATA_MISSING per fee
 * definition missing on the order date, and a non-blocking one per raw row it could not
 * hand to the mapper.
 */
export interface LoadedTrendyolParcel {
  readonly organizationId: string;
  readonly storeId: string;
  readonly estimateInput: TrendyolEstimateInput;
  readonly records: readonly TrendyolSettlementRecord[];
  readonly cargoItems: readonly TrendyolCargoInvoiceItem[];
  readonly settings: ResolvedProfitSettings;
  readonly isExcluded: boolean;
  readonly loadIssues: readonly ProfitIssue[];
}

/** Orders finance rows by (transactionDate, recordId); null dates sort last. */
function compareFinanceRows(
  a: { readonly transactionDate: Date | null; readonly recordId: string },
  b: { readonly transactionDate: Date | null; readonly recordId: string },
): number {
  const aTime = a.transactionDate === null ? Number.MAX_SAFE_INTEGER : a.transactionDate.getTime();
  const bTime = b.transactionDate === null ? Number.MAX_SAFE_INTEGER : b.transactionDate.getTime();
  if (aTime !== bTime) return aTime - bTime;
  return compareText(a.recordId, b.recordId);
}

/**
 * The subset of a shipping carrier the parcel loader needs: its identity and the two
 * name sources the order's cargo name is matched against -- the display name and
 * `orderCargoNames` (the exact cargoProviderName values Trendyol writes on orders for
 * this carrier). Barem attributes are not part of it: the estimate reads them from the
 * tariff version in force at the order date (`loadShippingTariff`).
 */
export interface CarrierRow {
  readonly id: string;
  readonly code: string;
  readonly displayName: string;
  readonly orderCargoNames: readonly string[];
}

/**
 * The provider name a not-recognized carrier issue carries: the name as Trendyol wrote
 * it, or null when Trendyol sent none or only whitespace. The frontend shows this name
 * inside its copy and falls back to an "unknown carrier" label on null, so a blank must
 * not reach it as an empty string.
 */
export function reportedProviderName(cargoProviderName: string | null): string | null {
  if (cargoProviderName === null || cargoProviderName.trim() === '') {
    return null;
  }
  return cargoProviderName;
}

/**
 * The carrier whose tariff the order's shipping estimate should use. Trendyol stamps
 * each order with the carrier it assigned (`cargoProviderName`); that string is the
 * getProviders "Name" ("PTT Kargo Marketplace", ...), which seeds the carrier's
 * `orderCargoNames` -- NOT its short `display_name` ("PTT Kargo"). So a carrier is
 * matched when the order's name equals either its display name OR one of its
 * `orderCargoNames`. Both sides are compared by `normalizeCargoProviderName` (NFC,
 * Turkish I folding, lowercase, spacing and punctuation collapsed -- a deterministic,
 * non-locale compare).
 *
 * When exactly one carrier matches it wins. Otherwise the carrier is NOT recognized and
 * the result is null (the store default is never used on an order): a null name or one
 * that normalises to nothing (blank, "***"), an "Alternative Delivery" or any other
 * unknown name, AND the ambiguous case where two or more distinct carriers claim the same
 * normalised name (never a silent pick among equals). Inactive carriers are never passed
 * in (the query filters `active = true`), so an inactive namesake is not recognized either.
 *
 * For an own-contract store the matched carrier still drives Barem eligibility, while
 * the own desi tariff stays store-level -- intended (plan decision 3): the carrier
 * identity decides whether Barem applies, the store's own prices decide the amount. A
 * not-recognized carrier there only means no Barem, never a zero estimate.
 */
export function resolveOrderCarrier(
  cargoProviderName: string | null,
  carriers: readonly CarrierRow[],
): CarrierRow | null {
  if (cargoProviderName === null) {
    return null;
  }
  const normalized = normalizeCargoProviderName(cargoProviderName);
  if (normalized === '') {
    return null;
  }
  const matches = carriers.filter(
    (carrier) =>
      normalizeCargoProviderName(carrier.displayName) === normalized ||
      carrier.orderCargoNames.some((name) => normalizeCargoProviderName(name) === normalized),
  );
  // Collapse to distinct carriers: one carrier matching on both its display name and an
  // orderCargoNames entry is still a single match. Zero or 2+ distinct -> not recognized.
  const distinct = new Map(matches.map((carrier) => [carrier.id, carrier]));
  if (distinct.size !== 1) {
    return null;
  }
  const [match] = distinct.values();
  return match ?? null;
}

/**
 * The active Trendyol carriers an order's cargo name is matched against
 * (`resolveOrderCarrier`), in a stable order. The single read behind both the live
 * parcel load and the order profit snapshot. Active Trendyol carriers are a small
 * platform-global reference table shared across every organization, so this read
 * carries no tenant filter by design -- like the commission-rate and fee reference
 * reads (Gorev 1, engine v6).
 */
export async function loadActiveTrendyolCarriers(
  tx: Prisma.TransactionClient,
): Promise<CarrierRow[]> {
  return tx.shippingCarrier.findMany({
    where: { platform: Platform.TRENDYOL, active: true },
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    select: { id: true, code: true, displayName: true, orderCargoNames: true },
  });
}

/**
 * Loads one Trendyol order (parcel) from the database into the pure inputs of the
 * Phase 2A Trendyol module. Reads only; filters every store-scoped table by the
 * order's store and every org-scoped table by the order's organization. Throws
 * `ParcelNotFoundError` when the order is not this organization's, and
 * `UnsupportedPlatformError` when the store is not a Trendyol store.
 *
 * Order profit snapshot (plan PR-2, decision 5): a captured order reads its carrier
 * and shipping tariff source from its capture, and a captured item reads its desi,
 * digital flag, category, brand, synced rate, category rule rates and pinned cost
 * versions from its capture, whatever its variant is today. An uncaptured order or
 * item reads the live values. Writes nothing: an uncaptured order stays live here
 * until a recompute captures it. The query count does not depend on the item count.
 */
export async function loadTrendyolParcel(
  tx: Prisma.TransactionClient,
  params: { readonly organizationId: string; readonly orderId: string },
): Promise<LoadedTrendyolParcel> {
  const { organizationId, orderId } = params;

  const order = await tx.order.findFirst({
    where: { id: orderId, organizationId },
    include: {
      store: true,
      items: { include: { productVariant: { include: { product: true } } } },
      // The engine reads only orderShipmentPackageId and cargoTrackingNumber of a claim
      // and status and orderItemId of its items. The claims sync enqueues a recompute
      // only when one of those changes (apps/sync-worker/src/handlers/claim-change.ts):
      // a new engine read from a claim must be added to that change check too.
      claims: { include: { items: true } },
    },
  });
  if (order === null) {
    throw new ParcelNotFoundError(orderId);
  }

  const store = order.store;
  if (store.platform !== Platform.TRENDYOL) {
    throw new UnsupportedPlatformError(store.platform);
  }

  const storeId = order.storeId;
  const orderDate = order.orderDate;
  const businessDate = getBusinessDate(orderDate);

  // Captured items read their capture; uncaptured ones read the live variant.
  const capturedItems = order.items.filter((item) => item.profitSnapshotAt !== null);
  const uncapturedItems = order.items.filter((item) => item.profitSnapshotAt === null);
  const itemsWithInputs = order.items.map((item) => ({ item, inputs: itemProductInputs(item) }));

  // --- Snapshot items (decision 7: no item carries a cancellation flag) ---
  const items: ParcelItemSnapshot[] = itemsWithInputs.map(({ item, inputs }) => {
    const listGross = dec(item.lineListGross);
    const sellerDiscountGross = dec(item.lineSellerDiscountGross);
    return {
      orderItemId: item.id,
      productVariantId: item.productVariantId,
      barcode: item.barcode,
      quantity: item.quantity,
      listGross,
      // Never lineSaleGross: the sale is list minus the seller-funded discount, so a
      // marketplace-funded discount does not shrink it (Inceleme odagi 5).
      sellerDiscountGross,
      saleGross: listGross.sub(sellerDiscountGross),
      saleVatRatePct: dec(item.saleVatRate),
      unitDesi: inputs.unitDesi,
      isDigital: inputs.isDigital,
      isCancelled: false,
    };
  });

  // --- Per-item commission attributes ---
  const itemAttributes: TrendyolItemAttributes[] = itemsWithInputs.map(({ item, inputs }) => {
    // The rate the order line itself carried, read from the raw column. The legacy
    // commissionRate column can hold a category fallback, so it is never read here.
    // The module treats null or zero as "not sent", so a zero column becomes null.
    const orderCommissionRatePct = decOrNull(item.orderCommissionRatePct);
    return {
      orderItemId: item.id,
      // Orders never override the rate; the scenario engine is the only caller that
      // does. A stored order resolves through the chain below.
      commissionRatePctOverride: null,
      orderCommissionRatePct:
        orderCommissionRatePct !== null && orderCommissionRatePct.gt(ZERO)
          ? orderCommissionRatePct
          : null,
      syncedCommissionRatePct: inputs.syncedCommissionRatePct,
      categoryId: inputs.categoryId,
      brandId: inputs.brandId,
      ...(inputs.capturedCategoryRules !== null && {
        capturedCategoryRules: inputs.capturedCategoryRules,
      }),
    };
  });

  const attributes: TrendyolParcelAttributes = {
    fastDelivery: order.fastDelivery,
    fastDeliveryType: order.fastDeliveryType,
    // The order's own Trendyol data (never captured): with actualShipDate it decides the
    // Barem table (barem-tier.ts).
    agreedDeliveryDate: order.agreedDeliveryDate,
    actualShipDate: order.actualShipDate,
    usesSellerCargoAgreement: order.usesSellerCargoAgreement,
    items: itemAttributes,
  };

  // Issues the loader raises itself: missing reference data (below) and the raw finance
  // rows it cannot hand to the mapper (further down).
  const loadIssues: ProfitIssue[] = [];

  // --- Reference: fees, shipping, commission rules ---
  // A fee definition missing on the order date never throws here: it becomes a blocking
  // REFERENCE_DATA_MISSING issue and the fee is left out, so the statement is still written.
  const fees = await loadOrderFeeParams(tx, {
    orderDate,
    isExport: order.isExportSale,
    fastDeliveryType: order.fastDeliveryType,
    issues: loadIssues,
  });
  // The order's own carrier (the one Trendyol assigned, named by cargoProviderName)
  // drives the shipping estimate; the store default is never used on an order. When the
  // name is not recognized the carrier is null and the estimate records why. A captured
  // order uses the carrier recognized at its capture.
  const orderCarrier = await loadOrderCarrier(tx, order);
  const orderCarrierOutcome: TrendyolOrderCarrierOutcome =
    orderCarrier === null
      ? { kind: 'not-recognized', providerName: reportedProviderName(order.cargoProviderName) }
      : { kind: 'matched' };
  const shipping = await loadShippingTariff(tx, {
    storeId,
    // A captured order keeps the store's tariff source of its capture moment.
    source: order.snapshotShippingTariffSource ?? store.shippingTariffSource,
    carrier: orderCarrier,
    at: orderDate,
    orderCarrierOutcome,
  });
  // Live rules only for the uncaptured items; a captured item carries its own rates.
  const commission = await loadCommissionRules(tx, uncapturedItems);

  // --- Costs ---
  const costs = [
    ...(await loadItemCosts(tx, { organizationId, orderItems: uncapturedItems })),
    ...(await loadCapturedItemCosts(tx, { organizationId, orderItems: capturedItems })),
  ];

  // --- Accepted returns (one unit per accepted claim item, capped at quantity) ---
  const acceptedReturns = buildAcceptedReturns(order.claims, order.items);

  // --- Raw finance records + cargo items ---
  // The barcodes the mapper matches records against: every item's barcode (all items
  // are active here, decision 7). The package-less binding below reuses this set.
  const itemBarcodes = [
    ...new Set(
      order.items
        .map((item) => item.barcode)
        .filter((barcode): barcode is string => barcode !== null),
    ),
  ];
  const { records, cargoItems } = await loadFinanceRecords(tx, {
    storeId,
    orderId: order.id,
    platformOrderNumber: order.platformOrderNumber,
    itemBarcodes,
    platformOrderId: order.platformOrderId,
    cargoTrackingNumber: order.cargoTrackingNumber,
    claims: order.claims,
    issues: loadIssues,
  });

  // --- Settings (decision 8: order snapshot wins, else store setting) ---
  const storeSettings = resolveProfitSettings(store.profitSettings);
  const settings: ResolvedProfitSettings = {
    includeStopaj: order.snapshotIncludeStopaj ?? storeSettings.includeStopaj,
    includeNegativeNetVat:
      order.snapshotIncludeNegativeNetVat ?? storeSettings.includeNegativeNetVat,
  };

  const estimateInput: TrendyolEstimateInput = {
    snapshot: {
      parcelId: order.id,
      orderDate,
      businessDate,
      isCancelled: order.status === OrderStatus.CANCELLED,
      isExportSale: order.isExportSale,
      measuredDesi: decOrNull(order.cargoDeci),
      items,
    },
    attributes,
    reference: { fees, shipping, commission },
    costs,
    acceptedReturns,
  };

  return {
    organizationId,
    storeId,
    estimateInput,
    records,
    cargoItems,
    settings,
    isExcluded: order.profitExcludedAt !== null,
    loadIssues,
  };
}

/**
 * The product inputs of one item the engine prices with: its unit desi, digital
 * flag, commission chain attributes and, for a captured item, the category rule
 * rates of its capture moment (null for an uncaptured item, which resolves from the
 * parcel-level live rules).
 */
interface ItemProductInputs {
  readonly unitDesi: Decimal | null;
  readonly isDigital: boolean;
  readonly syncedCommissionRatePct: Decimal | null;
  readonly categoryId: string | null;
  readonly brandId: string | null;
  readonly capturedCategoryRules: TrendyolCommissionRules | null;
}

/** The order item columns `itemProductInputs` reads: the snapshot columns and the live variant. */
interface ItemProductRow {
  readonly profitSnapshotAt: Date | null;
  readonly snapshotUnitDesi: Prisma.Decimal | null;
  readonly snapshotIsDigital: boolean | null;
  readonly snapshotSyncedCommissionRatePct: Prisma.Decimal | null;
  readonly snapshotCategoryId: bigint | null;
  readonly snapshotBrandId: bigint | null;
  readonly snapshotCategoryRatePct: Prisma.Decimal | null;
  readonly snapshotCategoryBrandRatePct: Prisma.Decimal | null;
  readonly productVariant: {
    readonly dimensionalWeightOverride: Prisma.Decimal | null;
    readonly syncedDimensionalWeight: Prisma.Decimal | null;
    readonly isDigital: boolean;
    readonly syncedCommissionRate: Prisma.Decimal | null;
    readonly product: { readonly categoryId: bigint | null; readonly brandId: bigint | null };
  } | null;
}

/**
 * An item's product inputs. A captured item reads its capture, independent of its
 * variant today (the variant may since have been corrected, re-linked or deleted);
 * an uncaptured item reads its live variant and product.
 */
function itemProductInputs(item: ItemProductRow): ItemProductInputs {
  if (item.profitSnapshotAt !== null) {
    return {
      unitDesi: decOrNull(item.snapshotUnitDesi),
      isDigital: item.snapshotIsDigital ?? false,
      syncedCommissionRatePct: decOrNull(item.snapshotSyncedCommissionRatePct),
      categoryId: item.snapshotCategoryId?.toString() ?? null,
      brandId: item.snapshotBrandId?.toString() ?? null,
      capturedCategoryRules: capturedCategoryRules(item),
    };
  }

  const variant = item.productVariant;
  const product = variant?.product ?? null;
  return {
    // The user override wins when set, else the synced desi; both null = no desi
    // (the engine reports UNKNOWN_DESI). 0 is a real desi.
    unitDesi: decOrNull(
      variant?.dimensionalWeightOverride ?? variant?.syncedDimensionalWeight ?? null,
    ),
    isDigital: variant?.isDigital ?? false,
    syncedCommissionRatePct: decOrNull(variant?.syncedCommissionRate ?? null),
    categoryId: product?.categoryId?.toString() ?? null,
    brandId: product?.brandId?.toString() ?? null,
    capturedCategoryRules: null,
  };
}

/**
 * The one-item commission rules of a captured item, built from its two captured
 * rates. A null rate stays out of its map, so the item never falls back to a live
 * rule: with both rates null its category rung finds nothing.
 */
function capturedCategoryRules(item: ItemProductRow): TrendyolCommissionRules {
  const categoryRatePct = new Map<string, Decimal>();
  const categoryBrandRatePct = new Map<string, Decimal>();
  if (item.snapshotCategoryId === null) {
    return { categoryRatePct, categoryBrandRatePct };
  }
  const categoryId = item.snapshotCategoryId.toString();
  if (item.snapshotCategoryRatePct !== null) {
    categoryRatePct.set(categoryId, dec(item.snapshotCategoryRatePct));
  }
  if (item.snapshotBrandId !== null && item.snapshotCategoryBrandRatePct !== null) {
    categoryBrandRatePct.set(
      trendyolCategoryBrandKey(categoryId, item.snapshotBrandId.toString()),
      dec(item.snapshotCategoryBrandRatePct),
    );
  }
  return { categoryRatePct, categoryBrandRatePct };
}

/**
 * The carrier whose tariff prices the order, or null when it is not recognized. A
 * captured order reads the carrier recognized at its capture by id -- with no
 * active filter, since the carrier may have been deactivated since; a carrier that
 * was never recognized (or no longer exists) is not recognized. An uncaptured order
 * matches its cargo name against the active carriers.
 */
async function loadOrderCarrier(
  tx: Prisma.TransactionClient,
  order: {
    readonly profitSnapshotAt: Date | null;
    readonly snapshotCarrierId: string | null;
    readonly cargoProviderName: string | null;
  },
): Promise<{ readonly id: string; readonly code: string } | null> {
  if (order.profitSnapshotAt !== null) {
    if (order.snapshotCarrierId === null) {
      return null;
    }
    return tx.shippingCarrier.findUnique({
      where: { id: order.snapshotCarrierId },
      select: { id: true, code: true },
    });
  }
  const carrier = resolveOrderCarrier(
    order.cargoProviderName,
    await loadActiveTrendyolCarriers(tx),
  );
  return carrier === null ? null : { id: carrier.id, code: carrier.code };
}

/** The cost versions a captured item was pinned to; a null column (nullable in the database) is an empty list. */
function capturedCostVersionIds(ids: readonly string[] | null): readonly string[] {
  return ids ?? [];
}

/**
 * The seller cost inputs of the captured items: per item, the cost profile versions
 * pinned in its capture, each as a one-version profile, in the stored order. Read in
 * one org-filtered query for every item. An item with no pinned version is omitted;
 * the cost module raises MISSING_COST itself, as for an uncaptured item without cost.
 */
async function loadCapturedItemCosts(
  tx: Prisma.TransactionClient,
  params: {
    readonly organizationId: string;
    readonly orderItems: readonly {
      readonly id: string;
      readonly snapshotCostProfileVersionIds: readonly string[] | null;
    }[];
  },
): Promise<ItemCostInput[]> {
  const { organizationId, orderItems } = params;
  const pinned = orderItems.map((item) => ({
    orderItemId: item.id,
    versionIds: capturedCostVersionIds(item.snapshotCostProfileVersionIds),
  }));
  const profilesByVersionId = await loadPinnedCostProfilesByVersionId(tx, {
    organizationId,
    versionIds: pinned.flatMap((entry) => entry.versionIds),
  });

  const costs: ItemCostInput[] = [];
  for (const { orderItemId, versionIds } of pinned) {
    const profiles = versionIds
      .map((versionId) => profilesByVersionId.get(versionId))
      .filter((profile): profile is ItemCostProfileInput => profile !== undefined);
    if (profiles.length === 0) continue;
    costs.push({ orderItemId, profiles });
  }
  return costs;
}

/** The category and category+brand commission rules for the items' categories. */
async function loadCommissionRules(
  tx: Prisma.TransactionClient,
  orderItems: readonly {
    readonly productVariant: { readonly product: { readonly categoryId: bigint | null } } | null;
  }[],
): Promise<TrendyolCommissionRules> {
  const categoryIds = orderItems
    .map((item) => item.productVariant?.product.categoryId ?? null)
    .filter((categoryId): categoryId is bigint => categoryId !== null);
  return loadCommissionRulesForCategories(tx, { categoryIds });
}

/**
 * The seller cost inputs per item: every cost profile attached to the item's
 * variant (org-filtered), with its full version history. An item without a variant
 * or without profiles is omitted; the cost module raises MISSING_COST itself.
 */
async function loadItemCosts(
  tx: Prisma.TransactionClient,
  params: {
    readonly organizationId: string;
    readonly orderItems: readonly {
      readonly id: string;
      readonly productVariantId: string | null;
    }[];
  },
): Promise<ItemCostInput[]> {
  const { organizationId, orderItems } = params;
  const variantIds = orderItems
    .map((item) => item.productVariantId)
    .filter((variantId): variantId is string => variantId !== null);
  const profilesByVariant = await loadCostProfilesByVariant(tx, { organizationId, variantIds });

  const costs: ItemCostInput[] = [];
  for (const item of orderItems) {
    if (item.productVariantId === null) continue;
    const profiles = profilesByVariant.get(item.productVariantId);
    if (profiles === undefined || profiles.length === 0) continue;
    costs.push({ orderItemId: item.id, profiles });
  }
  return costs;
}

/**
 * The accepted returns per item: one unit for every Accepted claim item with a
 * non-null order item id, capped at the item's ordered quantity.
 */
function buildAcceptedReturns(
  claims: readonly {
    readonly items: readonly { readonly orderItemId: string | null; readonly status: string }[];
  }[],
  orderItems: readonly { readonly id: string; readonly quantity: number }[],
): AcceptedReturn[] {
  const quantityByItemId = new Map(orderItems.map((item) => [item.id, item.quantity]));
  const acceptedByItemId = new Map<string, number>();
  for (const claim of claims) {
    for (const claimItem of claim.items) {
      if (claimItem.status !== CLAIM_ITEM_STATUS_ACCEPTED || claimItem.orderItemId === null)
        continue;
      if (!quantityByItemId.has(claimItem.orderItemId)) continue;
      acceptedByItemId.set(
        claimItem.orderItemId,
        (acceptedByItemId.get(claimItem.orderItemId) ?? 0) + 1,
      );
    }
  }

  const accepted: AcceptedReturn[] = [];
  for (const item of orderItems) {
    const count = acceptedByItemId.get(item.id);
    if (count === undefined) continue;
    accepted.push({
      orderItemId: item.id,
      acceptedQuantity: Math.min(count, item.quantity),
    });
  }
  return accepted;
}

/** A raw finance record row, with the columns the mappers and the loader read. */
interface FinanceRow {
  readonly family: FinanceRecordFamily;
  readonly transactionType: string;
  readonly recordId: string;
  readonly invoiceSerial: string | null;
  readonly barcode: string | null;
  readonly paymentOrderId: string | null;
  readonly parcelUniqueId: string | null;
  readonly transactionDate: Date | null;
  readonly debt: Prisma.Decimal | null;
  readonly credit: Prisma.Decimal | null;
  readonly commissionAmount: Prisma.Decimal | null;
  readonly amountGross: Prisma.Decimal | null;
  readonly desi: Prisma.Decimal | null;
}

/** The non-blocking issue for a raw finance row the loader cannot hand to the mapper. */
function unmappedRecordIssue(row: FinanceRow): ProfitIssue {
  return {
    code: ProfitIssueCode.UNMAPPED_MARKETPLACE_RECORD,
    orderItemId: null,
    detail: `FINANCE_RECORD:${row.family}:${row.transactionType}:${row.recordId}`,
  };
}

/**
 * The raw settlement/otherfinancials records and cargo-invoice items of the parcel,
 * always filtered by the order's store. Settlement rows match the order's outbound
 * package or any return package, plus package-less rows bound by order number and
 * barcode (see `loadPackagelessSettlementRows`); PaymentOrder rows match those
 * settlements' payment orders; cargo items match the order's or a claim's cargo
 * tracking number. A row the loader cannot map (an unknown transaction type, or a
 * cargo item with no serial or amount) becomes a non-blocking issue instead of being
 * dropped silently.
 */
async function loadFinanceRecords(
  tx: Prisma.TransactionClient,
  params: {
    readonly storeId: string;
    readonly orderId: string;
    readonly platformOrderNumber: string | null;
    readonly itemBarcodes: readonly string[];
    readonly platformOrderId: string;
    readonly cargoTrackingNumber: bigint | null;
    readonly claims: readonly {
      readonly orderShipmentPackageId: string | null;
      readonly cargoTrackingNumber: bigint | null;
    }[];
    readonly issues: ProfitIssue[];
  },
): Promise<{ records: TrendyolSettlementRecord[]; cargoItems: TrendyolCargoInvoiceItem[] }> {
  const {
    storeId,
    orderId,
    platformOrderNumber,
    itemBarcodes,
    platformOrderId,
    cargoTrackingNumber,
    claims,
    issues,
  } = params;

  const returnPackageIds = claims
    .map((claim) => claim.orderShipmentPackageId)
    .filter((id): id is string => id !== null);
  const packageSettlementRows = await tx.marketplaceFinanceRecord.findMany({
    where: {
      storeId,
      family: FinanceRecordFamily.SETTLEMENT,
      shipmentPackageId: { in: [platformOrderId, ...returnPackageIds] },
    },
  });

  // Package-less settlement rows (Gorev 4B) are appended here, BEFORE the payment-order
  // ids are collected, so their payment cycle loads too.
  const packagelessRows = await loadPackagelessSettlementRows(tx, {
    storeId,
    orderId,
    platformOrderNumber,
    itemBarcodes,
  });
  const settlementRows = [...packageSettlementRows, ...packagelessRows];

  const paymentOrderIds = [
    ...new Set(
      settlementRows.map((row) => row.paymentOrderId).filter((id): id is string => id !== null),
    ),
  ];
  const paymentOrderRows =
    paymentOrderIds.length === 0
      ? []
      : await tx.marketplaceFinanceRecord.findMany({
          where: {
            storeId,
            family: FinanceRecordFamily.OTHER_FINANCIAL,
            transactionType: TRENDYOL_PAYMENT_ORDER_TRANSACTION_TYPE,
            paymentOrderId: { in: paymentOrderIds },
          },
        });

  const cargoKeys = [
    ...new Set(
      [cargoTrackingNumber, ...claims.map((claim) => claim.cargoTrackingNumber)]
        .filter((value): value is bigint => value !== null)
        .map((value) => value.toString()),
    ),
  ];
  const cargoRows =
    cargoKeys.length === 0
      ? []
      : await tx.marketplaceFinanceRecord.findMany({
          where: {
            storeId,
            family: FinanceRecordFamily.CARGO_INVOICE_ITEM,
            parcelUniqueId: { in: cargoKeys },
          },
        });

  const records: TrendyolSettlementRecord[] = [];
  for (const row of [...settlementRows, ...paymentOrderRows].sort(compareFinanceRows)) {
    const transactionType = row.transactionType;
    if (!isTrendyolTransactionType(transactionType)) {
      issues.push(unmappedRecordIssue(row));
      continue;
    }
    records.push({
      recordId: row.recordId,
      transactionType,
      barcode: row.barcode,
      // The vendor sends 0 on the unused side of a record; a null column means zero.
      debt: row.debt === null ? ZERO : dec(row.debt),
      credit: row.credit === null ? ZERO : dec(row.credit),
      commissionAmount: decOrNull(row.commissionAmount),
      paymentOrderId: row.paymentOrderId,
    });
  }

  const cargoItems: TrendyolCargoInvoiceItem[] = [];
  for (const row of [...cargoRows].sort(compareFinanceRows)) {
    const invoiceSerial = row.invoiceSerial;
    const amountGross = row.amountGross;
    const parcelUniqueId = row.parcelUniqueId;
    if (invoiceSerial === null || amountGross === null || parcelUniqueId === null) {
      issues.push(unmappedRecordIssue(row));
      continue;
    }
    cargoItems.push({
      invoiceSerial,
      parcelUniqueId,
      itemType: row.transactionType,
      amountGross: dec(amountGross),
      desi: decOrNull(row.desi),
    });
  }

  return { records, cargoItems };
}

/**
 * The package-less settlement rows (shipment_package_id NULL) that bind to this parcel
 * by order number and barcode (Gorev 4B). Trendyol returns and their coupon/discount
 * reversals can carry the RETURN package id or none at all; the legacy third binding
 * layer matched these dateless-package rows by order number and barcode, used ONLY when
 * the package id is null -- a non-null but unmatched package id is never guessed.
 *
 * A row binds only when all four hold: (a) its transaction type is a return-leg type
 * (TRENDYOL_PACKAGELESS_BINDABLE_TYPES: Return, DiscountCancel, CouponCancel) -- only
 * return-leg records arrive without a package, and a package-less Sale/Discount/Coupon
 * would double-count a sale that already has a package-bound row; (b) its order_number
 * equals the parcel's platform order number; (c) one of the parcel's items (the same
 * barcode set the mapper matches against) carries the row's barcode; (d) no OTHER parcel
 * of the same order number in the same store carries that barcode (a split shipment makes
 * the row ambiguous, so it binds to neither, is never counted twice, and raises no
 * spurious sibling warning). Returns [] when the parcel has no platform order number
 * (null or empty) or no item barcode -- there is no key to bind on. Both queries are
 * store-scoped (tenant defense); the sibling check reaches order_items only through orders
 * of this store.
 */
async function loadPackagelessSettlementRows(
  tx: Prisma.TransactionClient,
  params: {
    readonly storeId: string;
    readonly orderId: string;
    readonly platformOrderNumber: string | null;
    readonly itemBarcodes: readonly string[];
  },
): Promise<FinanceRow[]> {
  const { storeId, orderId, platformOrderNumber, itemBarcodes } = params;
  if (platformOrderNumber === null || platformOrderNumber === '' || itemBarcodes.length === 0) {
    return [];
  }

  const candidates = await tx.marketplaceFinanceRecord.findMany({
    where: {
      storeId,
      family: FinanceRecordFamily.SETTLEMENT,
      shipmentPackageId: null,
      // Only return-leg types bind package-less; a package-less Sale/Discount/Coupon would
      // double-count a sale that already has a package-bound row. The list is derived from
      // the kind table, so a kind change flows through automatically.
      transactionType: { in: [...TRENDYOL_PACKAGELESS_BINDABLE_TYPES] },
      orderNumber: platformOrderNumber,
      barcode: { in: [...itemBarcodes] },
    },
  });
  if (candidates.length === 0) {
    return [];
  }

  // Sibling check: the barcodes another parcel of the same order number (same store)
  // carries. A candidate whose barcode a sibling also carries is ambiguous and binds to
  // neither parcel. Reached only through this store's orders, so no other tenant leaks.
  const candidateBarcodes = [
    ...new Set(
      candidates.map((row) => row.barcode).filter((barcode): barcode is string => barcode !== null),
    ),
  ];
  const siblingItems = await tx.orderItem.findMany({
    where: {
      barcode: { in: candidateBarcodes },
      order: { storeId, platformOrderNumber, id: { not: orderId } },
    },
    select: { barcode: true },
  });
  const siblingBarcodes = new Set(
    siblingItems
      .map((item) => item.barcode)
      .filter((barcode): barcode is string => barcode !== null),
  );

  return candidates.filter((row) => row.barcode !== null && !siblingBarcodes.has(row.barcode));
}
