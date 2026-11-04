import { Decimal } from 'decimal.js';
import type { Prisma } from '@pazarsync/db';
import { Platform } from '@pazarsync/db/enums';
import { resolveProfitSettings, type ResolvedProfitSettings } from '@pazarsync/utils';

import { type ItemCostProfileInput } from '../core/seller-costs/build-seller-cost-lines';
import { isTrendyolBaremEligible } from '../marketplaces/trendyol/barem-eligibility';
import { type TrendyolScenarioBase } from '../marketplaces/trendyol/scenario';
import {
  type TrendyolCommissionBand,
  type TrendyolReferenceData,
} from '../marketplaces/trendyol/trendyol-inputs';
import { UnsupportedPlatformError } from './errors';
import {
  dec,
  decOrNull,
  loadCommissionRulesForCategories,
  loadCostProfilesByVariant,
  loadFeeParams,
  loadShippingTariff,
  loadTariffCandidatesByBarcode,
  resolveTariffBandsAt,
  type TariffCandidate,
} from './trendyol-reference-loaders';

/**
 * The Turkish standard VAT rate (percent) a scenario uses when a variant carries no
 * explicit sale VAT rate. Replaces the legacy `?? 20` literal of the product-pricing
 * assembly; a variant's own rate always wins when present.
 */
const DEFAULT_SALE_VAT_RATE_PCT = 20;

/**
 * The outcome of loading one variant's scenario base. `VARIANT_NOT_FOUND` is the
 * only unavailable reason: a variant that is not this organization and store's. A
 * missing carrier, a missing desi or a missing commission rule are NOT load
 * failures -- they surface as estimate issues when the base is evaluated, exactly
 * as they do for a stored order.
 */
export type ScenarioLoadResult =
  | { readonly kind: 'ready'; readonly base: TrendyolScenarioBase }
  | { readonly kind: 'unavailable'; readonly reason: 'VARIANT_NOT_FOUND' };

/** One variant to price, with the tariff anchor its screen resolves bands at (null = no bands). */
interface ScenarioVariantRequest {
  readonly variantId: string;
  readonly tariffAnchor: Date | null;
}

/** The variant columns the scenario base reads, with its product's category and brand. */
interface VariantForScenario {
  readonly id: string;
  readonly barcode: string;
  readonly vatRate: number | null;
  readonly isDigital: boolean;
  readonly syncedCommissionRate: Prisma.Decimal | null;
  readonly syncedDimensionalWeight: Prisma.Decimal;
  readonly dimensionalWeightOverride: Prisma.Decimal | null;
  readonly deliveryDuration: number | null;
  readonly product: { readonly categoryId: bigint | null; readonly brandId: bigint | null };
}

/** The store columns the scenario base reads, with its default shipping carrier. */
interface StoreForScenario {
  readonly platform: Platform;
  readonly shippingTariffSource: TrendyolReferenceData['shipping']['source'];
  readonly profitSettings: Prisma.JsonValue;
  readonly defaultShippingCarrier: {
    readonly id: string;
    readonly code: string;
    readonly supportsBaremDestek: boolean;
    readonly maxBaremDesi: number;
    readonly maxBaremEligibleDeliveryDuration: number;
  } | null;
}

/** Builds one variant's scenario base from the pre-loaded, store-wide reference data. */
function buildScenarioBase(params: {
  readonly variant: VariantForScenario;
  readonly tariffAnchor: Date | null;
  readonly scenarioDate: Date;
  readonly store: StoreForScenario;
  readonly reference: TrendyolReferenceData;
  readonly settings: ResolvedProfitSettings;
  readonly costs: readonly ItemCostProfileInput[];
  readonly tariffCandidatesByBarcode: ReadonlyMap<string, TariffCandidate[]>;
}): TrendyolScenarioBase {
  const { variant, tariffAnchor, scenarioDate, store, reference, settings, costs } = params;

  const carrier = store.defaultShippingCarrier;
  const tariffBands: readonly TrendyolCommissionBand[] | null =
    tariffAnchor === null
      ? null
      : resolveTariffBandsAt(params.tariffCandidatesByBarcode.get(variant.barcode), tariffAnchor);

  return {
    product: {
      variantId: variant.id,
      barcode: variant.barcode,
      saleVatRatePct: new Decimal(variant.vatRate ?? DEFAULT_SALE_VAT_RATE_PCT),
      // Desi floor is 0: the synced column is non-null, the user override wins when set.
      unitDesi: dec(variant.dimensionalWeightOverride ?? variant.syncedDimensionalWeight),
      isDigital: variant.isDigital,
      categoryId: variant.product.categoryId?.toString() ?? null,
      brandId: variant.product.brandId?.toString() ?? null,
      syncedCommissionRatePct: decOrNull(variant.syncedCommissionRate),
      tariffBands,
    },
    quantity: 1,
    commissionRatePctOverride: null,
    scenarioDate,
    fastDelivery: isTrendyolBaremEligible({
      deliveryDurationDays: variant.deliveryDuration,
      carrierMaxBaremDurationDays: carrier?.maxBaremEligibleDeliveryDuration ?? null,
    }),
    isExportSale: false,
    reference,
    costs,
    settings,
  };
}

/**
 * Builds the scenario input (`TrendyolScenarioBase`) for many variants of one store
 * in one pass, sharing the order loader's sub-loaders. Reads only, with a constant
 * number of queries regardless of how many variants are passed: the store, the
 * variants, their cost profiles, the tariff candidates, the commission rules and the
 * fee + shipping reference are each read once.
 *
 * Each variant's base prices one unit (`quantity: 1`) at the given `scenarioDate`,
 * with no commission override and as a domestic (non-export) sale; the screen that
 * calls `evaluateTrendyolScenario` supplies its own unit price and rate override.
 * Barem eligibility, the store's profit settings, the variant's attached cost
 * profiles (dropping any without a version) and the tariff bands covering the
 * variant's `tariffAnchor` (null anchor = no bands) all come from here.
 *
 * A variant that is not this organization and store's is `VARIANT_NOT_FOUND`. A
 * missing carrier, desi or commission rule is not a failure -- it surfaces as an
 * estimate issue on evaluation. A store-wide reference problem throws, as it does for
 * a stored order: `FeeDefinitionNotFoundError` when no fee definition covers the date,
 * `IncompleteFeeDefinitionError` when a used definition lacks its amount; the caller
 * turns that into empty profit with a log. A store that is not Trendyol throws
 * `UnsupportedPlatformError`.
 */
export async function loadTrendyolScenarioBases(
  tx: Prisma.TransactionClient,
  params: {
    readonly organizationId: string;
    readonly storeId: string;
    readonly scenarioDate: Date;
    readonly variants: readonly ScenarioVariantRequest[];
  },
): Promise<ReadonlyMap<string, ScenarioLoadResult>> {
  const { organizationId, storeId, scenarioDate, variants } = params;

  const result = new Map<string, ScenarioLoadResult>();

  const store = await tx.store.findFirst({
    where: { id: storeId, organizationId },
    include: { defaultShippingCarrier: true },
  });
  // No store for this organization means none of its variants are either: every
  // request degrades to VARIANT_NOT_FOUND rather than throwing.
  if (store === null) {
    for (const request of variants) {
      result.set(request.variantId, { kind: 'unavailable', reason: 'VARIANT_NOT_FOUND' });
    }
    return result;
  }
  if (store.platform !== Platform.TRENDYOL) {
    throw new UnsupportedPlatformError(store.platform);
  }

  const variantIds = [...new Set(variants.map((request) => request.variantId))];
  const rows = await tx.productVariant.findMany({
    where: { organizationId, storeId, id: { in: variantIds } },
    include: { product: true },
  });
  const variantById = new Map<string, VariantForScenario>(rows.map((row) => [row.id, row]));

  // Every found variant is priced from one shared reference load; a request for a
  // variant that is not this store's is VARIANT_NOT_FOUND.
  const foundVariants = rows;
  if (foundVariants.length === 0) {
    for (const request of variants) {
      result.set(request.variantId, { kind: 'unavailable', reason: 'VARIANT_NOT_FOUND' });
    }
    return result;
  }

  // Store-wide reference, read once and shared by every variant's base. The reads
  // run sequentially (not Promise.all), exactly like the order loader: this loader
  // takes a Prisma.TransactionClient and a caller may run it inside an interactive
  // transaction, where concurrent queries would contend on the single connection.
  const fees = await loadFeeParams(tx, {
    orderDate: scenarioDate,
    isExport: false,
    fastDeliveryType: null,
  });
  const shipping = await loadShippingTariff(tx, {
    storeId,
    source: store.shippingTariffSource,
    carrier: store.defaultShippingCarrier,
  });
  const commission = await loadCommissionRulesForCategories(tx, {
    categoryIds: foundVariants
      .map((variant) => variant.product.categoryId)
      .filter((categoryId): categoryId is bigint => categoryId !== null),
  });
  const costProfilesByVariant = await loadCostProfilesByVariant(tx, {
    organizationId,
    variantIds: foundVariants.map((variant) => variant.id),
  });
  const tariffCandidatesByBarcode = await loadTariffCandidatesByBarcode(tx, {
    storeId,
    barcodes: foundVariants.map((variant) => variant.barcode),
  });

  const reference: TrendyolReferenceData = { fees, shipping, commission };
  const settings = resolveProfitSettings(store.profitSettings);

  for (const request of variants) {
    const variant = variantById.get(request.variantId);
    if (variant === undefined) {
      result.set(request.variantId, { kind: 'unavailable', reason: 'VARIANT_NOT_FOUND' });
      continue;
    }
    const base = buildScenarioBase({
      variant,
      tariffAnchor: request.tariffAnchor,
      scenarioDate,
      store,
      reference,
      settings,
      costs: costProfilesByVariant.get(variant.id) ?? [],
      tariffCandidatesByBarcode,
    });
    result.set(request.variantId, { kind: 'ready', base });
  }

  return result;
}
