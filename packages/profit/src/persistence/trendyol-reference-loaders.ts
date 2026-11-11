// Shared Trendyol reference sub-loaders, used by both the per-order parcel loader
// (`load-trendyol-parcel`) and the batch scenario loader (`load-trendyol-scenario`).
// Each loader reads one kind of input (costs, fees, shipping, commission rules)
// for a SET of keys in a single query, so a caller that needs
// many variants in one pass issues a constant number of queries. This module is
// internal to the persistence layer; the package index re-exports only
// `loadCommissionRulesForCategories`, which the scenario screens use for their
// category fallback rate. Reads only; every store-scoped table is filtered by store
// and every org-scoped table by organization.

import { Decimal } from 'decimal.js';
import type { OrderFeeType, Prisma } from '@pazarsync/db';
import { CommissionRuleKind, Platform } from '@pazarsync/db/enums';

import {
  type CostProfileVersionInput,
  type ItemCostProfileInput,
} from '../core/seller-costs/build-seller-cost-lines';
import {
  TRENDYOL_SAME_DAY_SHIPPING_TYPE,
  trendyolCategoryBrandKey,
  type OverseasReturnTier,
  type TrendyolBaremBand,
  type TrendyolCommissionRules,
  type TrendyolFeeParams,
  type TrendyolOrderCarrierOutcome,
  type TrendyolShippingCarrier,
  type TrendyolShippingTariff,
} from '../marketplaces/trendyol/trendyol-inputs';
import {
  IncompleteFeeDefinitionError,
  resolveFeeDefinition,
  type FeeDefinitionAmountField,
} from '../resolve-fee-definition';

const ZERO = new Decimal(0);
const PERCENT = new Decimal(100);

/** Converts a Prisma Decimal (decimal.js) to a fresh decimal.js value. */
export function dec(value: Prisma.Decimal): Decimal {
  return new Decimal(value.toString());
}

/** Converts a nullable Prisma Decimal to a fresh decimal.js value or null. */
export function decOrNull(value: Prisma.Decimal | null): Decimal | null {
  return value === null ? null : dec(value);
}

/** A Prisma Decimal that a used fee needs; throws naming the fee type when null. */
function requireFeeField(
  value: Prisma.Decimal | null,
  feeType: OrderFeeType,
  field: FeeDefinitionAmountField,
): Decimal {
  if (value === null) {
    throw new IncompleteFeeDefinitionError(feeType, field);
  }
  return dec(value);
}

/** One cost profile version row -> the pure cost version input (decision 6: the version's effective date). */
function toCostVersion(version: {
  readonly effectiveFrom: Date;
  readonly version: number;
  readonly amountGross: Prisma.Decimal;
  readonly vatRate: Prisma.Decimal;
  readonly archivedAt: Date | null;
}): CostProfileVersionInput {
  return {
    effectiveFrom: version.effectiveFrom,
    versionNumber: version.version,
    amountGross: dec(version.amountGross),
    vatRatePct: dec(version.vatRate),
    archivedAt: version.archivedAt,
  };
}

// --- Cost profiles -----------------------------------------------------------

/**
 * The seller cost profiles of every given variant, org-filtered, each with its
 * full version history in (effectiveFrom, version) order. A profile with no
 * version is dropped: the cost module throws on a versionless profile, so it
 * could never be costed anyway. The result maps only variants that have at least
 * one usable profile; a variant with none is simply absent from the map.
 */
export async function loadCostProfilesByVariant(
  tx: Prisma.TransactionClient,
  params: { readonly organizationId: string; readonly variantIds: readonly string[] },
): Promise<Map<string, ItemCostProfileInput[]>> {
  const { organizationId } = params;
  const variantIds = [...new Set(params.variantIds)];
  const profilesByVariant = new Map<string, ItemCostProfileInput[]>();
  if (variantIds.length === 0) {
    return profilesByVariant;
  }

  const links = await tx.productVariantCostProfile.findMany({
    where: { organizationId, productVariantId: { in: variantIds } },
    include: {
      profile: {
        include: { versions: { orderBy: [{ effectiveFrom: 'asc' }, { version: 'asc' }] } },
      },
    },
  });

  for (const link of links) {
    const versions = link.profile.versions.map(toCostVersion);
    if (versions.length === 0) {
      continue; // a profile with no versions cannot be costed and would break indexing
    }
    const list = profilesByVariant.get(link.productVariantId) ?? [];
    list.push({ profileId: link.profile.id, profileType: link.profile.type, versions });
    profilesByVariant.set(link.productVariantId, list);
  }
  return profilesByVariant;
}

// --- Commission rules --------------------------------------------------------

/**
 * The category and category+brand commission rules for the given categories, in a
 * single query. Platform-global reference data, so it carries no tenant filter
 * (the category ids are the only scope).
 */
export async function loadCommissionRulesForCategories(
  tx: Prisma.TransactionClient,
  params: { readonly categoryIds: readonly bigint[] },
): Promise<TrendyolCommissionRules> {
  const categoryIds = [...new Set(params.categoryIds)];
  const categoryRatePct = new Map<string, Decimal>();
  const categoryBrandRatePct = new Map<string, Decimal>();
  if (categoryIds.length === 0) {
    return { categoryRatePct, categoryBrandRatePct };
  }

  const rows = await tx.marketplaceCommissionRate.findMany({
    where: {
      platform: Platform.TRENDYOL,
      ruleKind: { in: [CommissionRuleKind.CATEGORY, CommissionRuleKind.CATEGORY_BRAND] },
      categoryId: { in: categoryIds },
    },
  });
  for (const row of rows) {
    if (row.ruleKind === CommissionRuleKind.CATEGORY) {
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

// --- Fees --------------------------------------------------------------------

/**
 * The fee parameters effective on `orderDate`. The international-service fee and
 * the overseas-return tiers are resolved only for an export (micro) parcel; for a
 * domestic parcel they are unused, so a missing definition must not break it and
 * both rates are left at zero.
 */
export async function loadFeeParams(
  tx: Prisma.TransactionClient,
  params: {
    readonly orderDate: Date;
    readonly isExport: boolean;
    readonly fastDeliveryType: string | null;
  },
): Promise<TrendyolFeeParams> {
  const { orderDate, isExport, fastDeliveryType } = params;

  const psf = await resolveFeeDefinition(tx, {
    platform: Platform.TRENDYOL,
    feeType: 'PLATFORM_SERVICE',
    at: orderDate,
  });
  const psfStandardNet = requireFeeField(psf.fixedAmountNet, 'PLATFORM_SERVICE', 'fixedAmountNet');

  // The same-day tier is used only when the parcel is marked same-day shipping
  // (see estimate-service-fee). For any other parcel the value is unused, so a
  // missing FAST definition must not break it: fall back to the standard net.
  let psfSameDayNet = psfStandardNet;
  if (fastDeliveryType === TRENDYOL_SAME_DAY_SHIPPING_TYPE) {
    const psfFast = await resolveFeeDefinition(tx, {
      platform: Platform.TRENDYOL,
      feeType: 'PLATFORM_SERVICE_FAST',
      at: orderDate,
    });
    psfSameDayNet = requireFeeField(
      psfFast.fixedAmountNet,
      'PLATFORM_SERVICE_FAST',
      'fixedAmountNet',
    );
  }

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
    psfStandardNet,
    psfSameDayNet,
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

// --- Shipping ----------------------------------------------------------------

/** The shipping tariff mirror of resolve-tariff.ts: carrier, desi, barem and own rows. */
export async function loadShippingTariff(
  tx: Prisma.TransactionClient,
  params: {
    readonly storeId: string;
    readonly source: TrendyolShippingTariff['source'];
    readonly carrier: {
      readonly id: string;
      readonly code: string;
      readonly supportsBaremDestek: boolean;
      readonly maxBaremDesi: number;
    } | null;
    // How the order's carrier resolved; omitted (null) for the scenario / store-default
    // context, where the carrier field alone decides.
    readonly orderCarrierOutcome?: TrendyolOrderCarrierOutcome | null;
  },
): Promise<TrendyolShippingTariff> {
  const { storeId, source, carrier } = params;
  const orderCarrierOutcome = params.orderCarrierOutcome ?? null;

  let carrierInput: TrendyolShippingCarrier | null = null;
  const desiTariffNet = new Map<string, Decimal>();
  let baremBands: TrendyolBaremBand[] = [];

  if (carrier !== null) {
    carrierInput = {
      code: carrier.code,
      supportsBarem: carrier.supportsBaremDestek,
      maxBaremDesi: new Decimal(carrier.maxBaremDesi),
    };
    // One row per band, no version history: ShippingDesiTariff is unique on
    // (carrierId, desi) and ShippingBaremTariff on (carrierId, minOrderAmount,
    // maxOrderAmount). Read by carrierId only, exactly as resolve-tariff.ts does.
    // An effectiveFrom <= orderDate filter cannot pick a version here; it would
    // only drop the tariff for an order older than the seeded effective_from. A
    // historic order is estimated with today's tariff and its cargo invoice later
    // replaces the estimate. Versioned tariffs are a future shipping feature.
    const desiRows = await tx.shippingDesiTariff.findMany({
      where: { carrierId: carrier.id },
    });
    for (const row of desiRows) {
      desiTariffNet.set(row.desi.toString(), dec(row.priceNet));
    }
    const baremRows = await tx.shippingBaremTariff.findMany({
      where: { carrierId: carrier.id },
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

  return {
    source,
    carrier: carrierInput,
    desiTariffNet,
    baremBands,
    ownTariffNet,
    orderCarrierOutcome,
  };
}
