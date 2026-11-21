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
import { type ItemCostInput } from '../core/seller-costs/build-seller-cost-lines';
import { type TrendyolEstimateInput } from '../marketplaces/trendyol/estimate-parcel';
import {
  isTrendyolTransactionType,
  TRENDYOL_PACKAGELESS_BINDABLE_TYPES,
  TRENDYOL_PAYMENT_ORDER_TRANSACTION_TYPE,
  type TrendyolCargoInvoiceItem,
  type TrendyolSettlementRecord,
} from '../marketplaces/trendyol/settlement-records';
import {
  type TrendyolCommissionRules,
  type TrendyolItemAttributes,
  type TrendyolOrderCarrierOutcome,
  type TrendyolParcelAttributes,
} from '../marketplaces/trendyol/trendyol-inputs';
import { ParcelNotFoundError, UnsupportedPlatformError } from './errors';
import {
  dec,
  decOrNull,
  loadCommissionRulesForCategories,
  loadCostProfilesByVariant,
  loadFeeParams,
  loadShippingTariff,
} from './trendyol-reference-loaders';

const ZERO = new Decimal(0);

/**
 * Everything a parcel needs to be driven through the Phase 2A Trendyol module and
 * then written: the pure estimate input, the raw settlement + cargo records for the
 * mapper, the resolved profit settings, the exclusion flag, and the raw rows the
 * loader could not hand to the mapper (non-blocking issues the writer merges in).
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
 * `orderCargoNames`. Both sides are compared after `trim()` + `toLowerCase()` (a
 * deterministic, non-locale compare).
 *
 * When exactly one carrier matches it wins. Otherwise the carrier is NOT recognized and
 * the result is null (the store default is never used on an order): a null or blank name,
 * an "Alternative Delivery" / "***" or any other unknown name, AND the ambiguous case
 * where two or more distinct carriers claim the same name (never a silent pick among
 * equals). Inactive carriers are never passed in (the query filters `active = true`), so
 * an inactive namesake is not recognized either.
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
  const normalized = cargoProviderName.trim().toLowerCase();
  if (normalized === '') {
    return null;
  }
  const matches = carriers.filter(
    (carrier) =>
      carrier.displayName.trim().toLowerCase() === normalized ||
      carrier.orderCargoNames.some((name) => name.trim().toLowerCase() === normalized),
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
 * Loads one Trendyol order (parcel) from the database into the pure inputs of the
 * Phase 2A Trendyol module. Reads only; filters every store-scoped table by the
 * order's store and every org-scoped table by the order's organization. Throws
 * `ParcelNotFoundError` when the order is not this organization's, and
 * `UnsupportedPlatformError` when the store is not a Trendyol store.
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

  // --- Snapshot items (decision 7: no item carries a cancellation flag) ---
  const items: ParcelItemSnapshot[] = order.items.map((item) => {
    const variant = item.productVariant;
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
      unitDesi:
        variant === null
          ? null
          : dec(variant.dimensionalWeightOverride ?? variant.syncedDimensionalWeight),
      isDigital: variant?.isDigital ?? false,
      isCancelled: false,
    };
  });

  // --- Per-item commission attributes ---
  const itemAttributes: TrendyolItemAttributes[] = order.items.map((item) => {
    const variant = item.productVariant;
    const product = variant?.product ?? null;
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
      syncedCommissionRatePct: decOrNull(variant?.syncedCommissionRate ?? null),
      categoryId: product?.categoryId?.toString() ?? null,
      brandId: product?.brandId?.toString() ?? null,
    };
  });

  const attributes: TrendyolParcelAttributes = {
    fastDelivery: order.fastDelivery,
    fastDeliveryType: order.fastDeliveryType,
    actualShipDate: order.actualShipDate,
    usesSellerCargoAgreement: order.usesSellerCargoAgreement,
    items: itemAttributes,
  };

  // --- Reference: fees, shipping, commission rules ---
  const fees = await loadFeeParams(tx, {
    orderDate,
    isExport: order.isExportSale,
    fastDeliveryType: order.fastDeliveryType,
  });
  // The order's own carrier (the one Trendyol assigned, named by cargoProviderName)
  // drives the shipping estimate; the store default is never used on an order. When the
  // name is not recognized the carrier is null and the estimate records why. Active
  // Trendyol carriers are a small platform-global reference table shared across every
  // organization, so this read carries no tenant filter by design -- like the
  // commission-rate and fee reference reads (Gorev 1, engine v6).
  const activeCarriers = await tx.shippingCarrier.findMany({
    where: { platform: Platform.TRENDYOL, active: true },
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
  });
  const orderCarrier = resolveOrderCarrier(order.cargoProviderName, activeCarriers);
  const orderCarrierOutcome: TrendyolOrderCarrierOutcome =
    orderCarrier === null
      ? { kind: 'not-recognized', providerName: reportedProviderName(order.cargoProviderName) }
      : { kind: 'matched' };
  const shipping = await loadShippingTariff(tx, {
    storeId,
    source: store.shippingTariffSource,
    carrier: orderCarrier === null ? null : { id: orderCarrier.id, code: orderCarrier.code },
    at: orderDate,
    orderCarrierOutcome,
  });
  const commission = await loadCommissionRules(tx, order.items);

  // --- Costs ---
  const costs = await loadItemCosts(tx, { organizationId, orderItems: order.items });

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
  const loadIssues: ProfitIssue[] = [];
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
