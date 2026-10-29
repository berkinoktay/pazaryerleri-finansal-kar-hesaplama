import { Decimal } from 'decimal.js';
import type { Prisma } from '@pazarsync/db';
import { type Currency, Platform, ProfitIssueCode } from '@pazarsync/db/enums';
import {
  getBusinessDate,
  resolveProfitSettings,
  type ResolvedProfitSettings,
} from '@pazarsync/utils';

import { CURRENCY_TRY, toCurrencyCode } from '../core/fx/currency-code';
import { type FxRateQuote } from '../core/fx/select-fx-rate';
import { type AcceptedReturn, type ParcelItemSnapshot } from '../core/parcel-snapshot';
import { type ProfitIssue } from '../core/profit-issue';
import {
  type CostProfileVersionInput,
  type ItemCostInput,
  type ItemCostProfileInput,
} from '../core/seller-costs/build-seller-cost-lines';
import { type TrendyolEstimateInput } from '../marketplaces/trendyol/estimate-parcel';
import {
  isTrendyolTransactionType,
  type TrendyolCargoInvoiceItem,
  type TrendyolSettlementRecord,
} from '../marketplaces/trendyol/settlement-records';
import {
  parseStoredTariffBands,
  type StoredTariffBand,
} from '../marketplaces/trendyol/stored-tariff-bands';
import {
  trendyolCategoryBrandKey,
  type OverseasReturnTier,
  type TrendyolBaremBand,
  type TrendyolCommissionBand,
  type TrendyolCommissionRules,
  type TrendyolFeeParams,
  type TrendyolItemAttributes,
  type TrendyolParcelAttributes,
  type TrendyolShippingCarrier,
  type TrendyolShippingTariff,
} from '../marketplaces/trendyol/trendyol-inputs';
import { resolveFeeDefinition } from '../resolve-fee-definition';
import { ParcelNotFoundError, UnsupportedPlatformError } from './errors';

const ZERO = new Decimal(0);
const PERCENT = new Decimal(100);

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

/** Converts a Prisma Decimal (decimal.js) to a fresh decimal.js value. */
function dec(value: Prisma.Decimal): Decimal {
  return new Decimal(value.toString());
}

function decOrNull(value: Prisma.Decimal | null): Decimal | null {
  return value === null ? null : dec(value);
}

/** A Prisma Decimal that a used fee needs; throws naming the fee type when null. */
function requireFeeField(value: Prisma.Decimal | null, feeType: string, field: string): Decimal {
  if (value === null) {
    throw new Error(`${feeType} fee definition is missing ${field}`);
  }
  return dec(value);
}

/** Lexicographic comparison, the single text order used for record ids. */
function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
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

/** One stored tariff band -> a Trendyol commission band; the rate is already a percent. */
function toCommissionBand(band: StoredTariffBand): TrendyolCommissionBand {
  return {
    lowerLimit: band.lowerLimit === null ? null : new Decimal(band.lowerLimit),
    upperLimit: band.upperLimit === null ? null : new Decimal(band.upperLimit),
    ratePct: new Decimal(band.commissionPct),
  };
}

/** One cost profile version row -> the pure cost version input (decision 6: changedAt). */
function toCostVersion(version: {
  readonly changedAt: Date;
  readonly amountGross: Prisma.Decimal;
  readonly currency: Currency;
  readonly vatRate: Prisma.Decimal;
  readonly fxRateMode: CostProfileVersionInput['fxRateMode'];
  readonly manualFxRate: Prisma.Decimal | null;
  readonly archivedAt: Date | null;
}): CostProfileVersionInput {
  return {
    effectiveFrom: version.changedAt,
    amountGross: dec(version.amountGross),
    currency: toCurrencyCode(version.currency),
    vatRatePct: dec(version.vatRate),
    fxRateMode: version.fxRateMode,
    manualFxRate: decOrNull(version.manualFxRate),
    archivedAt: version.archivedAt,
  };
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
      store: { include: { organization: true, defaultShippingCarrier: true } },
      items: { include: { productVariant: { include: { product: true } } } },
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
  const accountingCurrency = toCurrencyCode(store.organization.currency);

  // ─── Snapshot items (decision 7: no item carries a cancellation flag) ──────
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

  // ─── Per-item tariff bands covering the order date ─────────────────────────
  const tariffBandsByItemId = await loadTariffBands(tx, {
    storeId,
    orderDate,
    orderItems: order.items,
  });

  // ─── Per-item commission attributes ────────────────────────────────────────
  const itemAttributes: TrendyolItemAttributes[] = order.items.map((item) => {
    const variant = item.productVariant;
    const product = variant?.product ?? null;
    const commissionRate = dec(item.commissionRate);
    return {
      orderItemId: item.id,
      orderCommissionRatePct: commissionRate.gt(ZERO) ? commissionRate : null,
      tariffBands: tariffBandsByItemId.get(item.id) ?? null,
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

  // ─── Reference: fees, shipping, commission rules ───────────────────────────
  const fees = await loadFeeParams(tx, { orderDate, isExport: order.micro });
  const shipping = await loadShippingTariff(tx, {
    storeId,
    orderDate,
    source: store.shippingTariffSource,
    carrier: store.defaultShippingCarrier,
  });
  const commission = await loadCommissionRules(tx, order.items);

  // ─── Costs + fx quotes ─────────────────────────────────────────────────────
  const costs = await loadItemCosts(tx, { organizationId, orderItems: order.items });
  const fxQuotes = await loadFxQuotes(tx, { businessDate, costs });

  // ─── Accepted returns (one unit per accepted claim item, capped at quantity) ─
  const acceptedReturns = buildAcceptedReturns(order.claims, order.items);

  // ─── Raw finance records + cargo items ─────────────────────────────────────
  const loadIssues: ProfitIssue[] = [];
  const { records, cargoItems } = await loadFinanceRecords(tx, {
    storeId,
    platformOrderId: order.platformOrderId,
    cargoTrackingNumber: order.cargoTrackingNumber,
    claims: order.claims,
    issues: loadIssues,
  });

  // ─── Settings (decision 8: order snapshot wins, else store setting) ─────────
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
      isCancelled: order.status === 'CANCELLED',
      isExportSale: order.micro,
      measuredDesi: decOrNull(order.cargoDeci),
      accountingCurrency,
      items,
    },
    attributes,
    reference: { fees, shipping, commission },
    costs,
    fxQuotes,
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

/** A commission tariff item row with the period + tariff createdAt tie-breakers. */
interface TariffCandidate {
  readonly id: string;
  readonly barcode: string;
  readonly bands: Prisma.JsonValue;
  readonly period: {
    readonly startsAt: Date | null;
    readonly endsAt: Date | null;
    readonly createdAt: Date;
    readonly tariff: { readonly createdAt: Date };
  };
}

/** True when `a` beats `b`: latest tariff createdAt, then latest period createdAt, then smallest id. */
function tariffCandidateBeats(a: TariffCandidate, b: TariffCandidate): boolean {
  const aTariff = a.period.tariff.createdAt.getTime();
  const bTariff = b.period.tariff.createdAt.getTime();
  if (aTariff !== bTariff) return aTariff > bTariff;
  const aPeriod = a.period.createdAt.getTime();
  const bPeriod = b.period.createdAt.getTime();
  if (aPeriod !== bPeriod) return aPeriod > bPeriod;
  return a.id < b.id;
}

/**
 * The tariff band list per order item. A candidate is a saved commission-tariff
 * item of the order's store with a matching barcode whose period fully bounds the
 * order date (both bounds non-null and startsAt <= orderDate <= endsAt). The
 * best candidate's parsed bands become the item's tariff bands; an empty band list
 * or no candidate leaves the item without tariff bands.
 */
async function loadTariffBands(
  tx: Prisma.TransactionClient,
  params: {
    readonly storeId: string;
    readonly orderDate: Date;
    readonly orderItems: readonly { readonly id: string; readonly barcode: string | null }[];
  },
): Promise<Map<string, TrendyolCommissionBand[]>> {
  const { storeId, orderDate, orderItems } = params;
  const barcodes = [
    ...new Set(
      orderItems
        .map((item) => item.barcode)
        .filter((barcode): barcode is string => barcode !== null),
    ),
  ];
  const result = new Map<string, TrendyolCommissionBand[]>();
  if (barcodes.length === 0) {
    return result;
  }

  const rows = await tx.commissionTariffItem.findMany({
    where: { storeId, barcode: { in: barcodes } },
    include: { period: { include: { tariff: true } } },
  });

  const bestByBarcode = new Map<string, TariffCandidate>();
  for (const row of rows) {
    const { startsAt, endsAt } = row.period;
    if (startsAt === null || endsAt === null) {
      continue; // a period with a null bound never covers the order date
    }
    if (startsAt.getTime() > orderDate.getTime() || endsAt.getTime() < orderDate.getTime()) {
      continue;
    }
    const candidate: TariffCandidate = {
      id: row.id,
      barcode: row.barcode,
      bands: row.bands,
      period: {
        startsAt,
        endsAt,
        createdAt: row.period.createdAt,
        tariff: { createdAt: row.period.tariff.createdAt },
      },
    };
    const current = bestByBarcode.get(row.barcode);
    if (current === undefined || tariffCandidateBeats(candidate, current)) {
      bestByBarcode.set(row.barcode, candidate);
    }
  }

  const bandsByBarcode = new Map<string, TrendyolCommissionBand[]>();
  for (const [barcode, candidate] of bestByBarcode) {
    const bands = parseStoredTariffBands(candidate.bands).map(toCommissionBand);
    if (bands.length > 0) {
      bandsByBarcode.set(barcode, bands);
    }
  }

  for (const item of orderItems) {
    if (item.barcode === null) continue;
    const bands = bandsByBarcode.get(item.barcode);
    if (bands !== undefined) {
      result.set(item.id, bands);
    }
  }
  return result;
}

/**
 * The fee parameters effective on the order date. The international-service fee and
 * the overseas-return tiers are resolved only for an export (micro) parcel; for a
 * domestic parcel they are unused, so a missing definition must not break it and
 * both rates are left at zero.
 */
async function loadFeeParams(
  tx: Prisma.TransactionClient,
  params: { readonly orderDate: Date; readonly isExport: boolean },
): Promise<TrendyolFeeParams> {
  const { orderDate, isExport } = params;

  const psf = await resolveFeeDefinition(tx, {
    platform: Platform.TRENDYOL,
    feeType: 'PLATFORM_SERVICE',
    at: orderDate,
  });
  const psfFast = await resolveFeeDefinition(tx, {
    platform: Platform.TRENDYOL,
    feeType: 'PLATFORM_SERVICE_FAST',
    at: orderDate,
  });
  const stoppage = await resolveFeeDefinition(tx, {
    platform: Platform.TRENDYOL,
    feeType: 'STOPPAGE',
    at: orderDate,
  });
  const commissionInvoice = await resolveFeeDefinition(tx, {
    platform: Platform.TRENDYOL,
    feeType: 'COMMISSION_INVOICE',
    at: orderDate,
  });
  const shippingDef = await resolveFeeDefinition(tx, {
    platform: Platform.TRENDYOL,
    feeType: 'SHIPPING',
    at: orderDate,
  });

  // The return-shipping VAT follows the SHIPPING definition, exactly as the legacy
  // path does; there is no separate return-shipping rate to resolve here.
  const shippingVatRatePct = dec(shippingDef.defaultVatRate);

  let internationalServiceRatePct = ZERO;
  let internationalServiceVatRatePct = ZERO;
  let overseasReturnTiers: readonly OverseasReturnTier[] = [];
  if (isExport) {
    const intl = await resolveFeeDefinition(tx, {
      platform: Platform.TRENDYOL,
      feeType: 'INTERNATIONAL_SERVICE',
      at: orderDate,
    });
    internationalServiceRatePct = requireFeeField(
      intl.rateOfSale,
      'INTERNATIONAL_SERVICE',
      'rateOfSale',
    ).mul(PERCENT);
    internationalServiceVatRatePct = dec(intl.defaultVatRate);
    overseasReturnTiers = await loadOverseasReturnTiers(tx, orderDate);
  }

  return {
    psfStandardNet: requireFeeField(psf.fixedAmountNet, 'PLATFORM_SERVICE', 'fixedAmountNet'),
    psfSameDayNet: requireFeeField(
      psfFast.fixedAmountNet,
      'PLATFORM_SERVICE_FAST',
      'fixedAmountNet',
    ),
    psfVatRatePct: dec(psf.defaultVatRate),
    stoppageRatePct: requireFeeField(stoppage.rateOfSale, 'STOPPAGE', 'rateOfSale').mul(PERCENT),
    commissionVatRatePct: dec(commissionInvoice.defaultVatRate),
    shippingVatRatePct,
    returnShippingVatRatePct: shippingVatRatePct,
    internationalServiceRatePct,
    internationalServiceVatRatePct,
    overseasReturnTiers,
  };
}

/** The micro-export return-fee tiers effective on the order date, rate scaled to a percent. */
async function loadOverseasReturnTiers(
  tx: Prisma.TransactionClient,
  orderDate: Date,
): Promise<OverseasReturnTier[]> {
  const rows = await tx.microExportReturnFeeTier.findMany({
    where: { effectiveFrom: { lte: orderDate } },
    orderBy: { effectiveFrom: 'desc' },
  });
  // Mirror resolve-overseas-return-rate: for each band keep the row with the latest
  // effectiveFrom on or before the order date.
  const byBand = new Map<string, OverseasReturnTier>();
  for (const row of rows) {
    const key = `${row.minSaleGross.toString()}:${row.maxSaleGross.toString()}`;
    if (!byBand.has(key)) {
      byBand.set(key, {
        minUnitSaleGross: dec(row.minSaleGross),
        maxUnitSaleGross: dec(row.maxSaleGross),
        ratePct: dec(row.rate).mul(PERCENT),
      });
    }
  }
  return [...byBand.values()];
}

/** The shipping tariff mirror of resolve-tariff.ts: carrier, desi, barem and own rows. */
async function loadShippingTariff(
  tx: Prisma.TransactionClient,
  params: {
    readonly storeId: string;
    readonly orderDate: Date;
    readonly source: TrendyolShippingTariff['source'];
    readonly carrier: {
      readonly id: string;
      readonly code: string;
      readonly supportsBaremDestek: boolean;
      readonly maxBaremDesi: number;
    } | null;
  },
): Promise<TrendyolShippingTariff> {
  const { storeId, orderDate, source, carrier } = params;

  let carrierInput: TrendyolShippingCarrier | null = null;
  const desiTariffNet = new Map<string, Decimal>();
  let baremBands: TrendyolBaremBand[] = [];

  if (carrier !== null) {
    carrierInput = {
      code: carrier.code,
      supportsBarem: carrier.supportsBaremDestek,
      maxBaremDesi: new Decimal(carrier.maxBaremDesi),
    };
    const desiRows = await tx.shippingDesiTariff.findMany({
      where: { carrierId: carrier.id, effectiveFrom: { lte: orderDate } },
    });
    for (const row of desiRows) {
      desiTariffNet.set(row.desi.toString(), dec(row.priceNet));
    }
    const baremRows = await tx.shippingBaremTariff.findMany({
      where: { carrierId: carrier.id, effectiveFrom: { lte: orderDate } },
      orderBy: { minOrderAmount: 'asc' },
    });
    baremBands = baremRows.map((row) => ({
      minOrderAmount: dec(row.minOrderAmount),
      maxOrderAmount: dec(row.maxOrderAmount),
      priceNet: dec(row.priceNet),
    }));
  }

  const ownRows = await tx.ownShippingTariff.findMany({ where: { storeId } });
  const ownTariffNet = new Map<string, Decimal>();
  for (const row of ownRows) {
    ownTariffNet.set(row.desi.toString(), dec(row.priceNet));
  }

  return { source, carrier: carrierInput, desiTariffNet, baremBands, ownTariffNet };
}

/** The category and category+brand commission rules for the items' categories. */
async function loadCommissionRules(
  tx: Prisma.TransactionClient,
  orderItems: readonly {
    readonly productVariant: { readonly product: { readonly categoryId: bigint | null } } | null;
  }[],
): Promise<TrendyolCommissionRules> {
  const categoryIds = [
    ...new Set(
      orderItems
        .map((item) => item.productVariant?.product.categoryId ?? null)
        .filter((categoryId): categoryId is bigint => categoryId !== null),
    ),
  ];
  const categoryRatePct = new Map<string, Decimal>();
  const categoryBrandRatePct = new Map<string, Decimal>();
  if (categoryIds.length === 0) {
    return { categoryRatePct, categoryBrandRatePct };
  }

  const rows = await tx.marketplaceCommissionRate.findMany({
    where: {
      platform: Platform.TRENDYOL,
      ruleKind: { in: ['CATEGORY', 'CATEGORY_BRAND'] },
      categoryId: { in: categoryIds },
    },
  });
  for (const row of rows) {
    if (row.ruleKind === 'CATEGORY') {
      categoryRatePct.set(row.categoryId.toString(), dec(row.baseRate));
    } else if (row.brandId !== null) {
      categoryBrandRatePct.set(
        trendyolCategoryBrandKey(row.categoryId.toString(), row.brandId.toString()),
        dec(row.baseRate),
      );
    }
  }
  return { categoryRatePct, categoryBrandRatePct };
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
  const variantIds = [
    ...new Set(
      orderItems
        .map((item) => item.productVariantId)
        .filter((variantId): variantId is string => variantId !== null),
    ),
  ];
  if (variantIds.length === 0) {
    return [];
  }

  const links = await tx.productVariantCostProfile.findMany({
    where: { organizationId, productVariantId: { in: variantIds } },
    include: { profile: { include: { versions: true } } },
  });

  const profilesByVariant = new Map<string, ItemCostProfileInput[]>();
  for (const link of links) {
    const versions = link.profile.versions.map(toCostVersion);
    if (versions.length === 0) {
      continue; // a profile with no versions cannot be costed and would break indexing
    }
    const list = profilesByVariant.get(link.productVariantId) ?? [];
    list.push({ profileId: link.profile.id, profileType: link.profile.type, versions });
    profilesByVariant.set(link.productVariantId, list);
  }

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
 * The fx quotes for every distinct non-TRY currency among the loaded cost versions:
 * the latest two rates on or before the business date, expressed against TRY.
 */
async function loadFxQuotes(
  tx: Prisma.TransactionClient,
  params: { readonly businessDate: string; readonly costs: readonly ItemCostInput[] },
): Promise<FxRateQuote[]> {
  const { businessDate, costs } = params;
  const currencies = new Set<Currency>();
  for (const cost of costs) {
    for (const profile of cost.profiles) {
      for (const version of profile.versions) {
        if (version.currency !== CURRENCY_TRY) {
          currencies.add(toCurrency(version.currency));
        }
      }
    }
  }
  if (currencies.size === 0) {
    return [];
  }

  const upperBound = new Date(`${businessDate}T00:00:00.000Z`);
  const quotes: FxRateQuote[] = [];
  for (const currency of currencies) {
    const rows = await tx.fxRate.findMany({
      where: { currency, rateDate: { lte: upperBound } },
      orderBy: { rateDate: 'desc' },
      take: 2,
    });
    for (const row of rows) {
      quotes.push({
        currency: toCurrencyCode(row.currency),
        rateDate: row.rateDate.toISOString().slice(0, 10),
        rateToBase: dec(row.rateToTry),
      });
    }
  }
  return quotes;
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
      if (claimItem.status !== 'Accepted' || claimItem.orderItemId === null) continue;
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
  readonly family: string;
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
 * package or any return package; PaymentOrder rows match those settlements' payment
 * orders; cargo items match the order's or a claim's cargo tracking number. A row
 * the loader cannot map (an unknown transaction type, or a cargo item with no serial
 * or amount) becomes a non-blocking issue instead of being dropped silently.
 */
async function loadFinanceRecords(
  tx: Prisma.TransactionClient,
  params: {
    readonly storeId: string;
    readonly platformOrderId: string;
    readonly cargoTrackingNumber: bigint | null;
    readonly claims: readonly {
      readonly orderShipmentPackageId: string | null;
      readonly cargoTrackingNumber: bigint | null;
    }[];
    readonly issues: ProfitIssue[];
  },
): Promise<{ records: TrendyolSettlementRecord[]; cargoItems: TrendyolCargoInvoiceItem[] }> {
  const { storeId, platformOrderId, cargoTrackingNumber, claims, issues } = params;

  const returnPackageIds = claims
    .map((claim) => claim.orderShipmentPackageId)
    .filter((id): id is string => id !== null);
  const settlementRows = await tx.marketplaceFinanceRecord.findMany({
    where: {
      storeId,
      family: 'SETTLEMENT',
      shipmentPackageId: { in: [platformOrderId, ...returnPackageIds] },
    },
  });

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
            family: 'OTHER_FINANCIAL',
            transactionType: 'PaymentOrder',
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
          where: { storeId, family: 'CARGO_INVOICE_ITEM', parcelUniqueId: { in: cargoKeys } },
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
 * Narrows a non-TRY `CurrencyCode` back to the Prisma `Currency` enum used by the
 * fx-rate query. The cost version carries the branded `CurrencyCode`; the three
 * supported currencies are the enum, and anything else is a loader bug, not data.
 */
function toCurrency(code: string): Currency {
  switch (code) {
    case 'USD':
      return 'USD';
    case 'EUR':
      return 'EUR';
    case 'TRY':
      return 'TRY';
    default:
      throw new Error(`Unsupported cost currency for fx lookup: ${code}`);
  }
}
