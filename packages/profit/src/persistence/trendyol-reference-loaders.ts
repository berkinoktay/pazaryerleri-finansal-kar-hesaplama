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
import type { FeeDefinition, OrderFeeType, Prisma } from '@pazarsync/db';
import {
  CommissionRuleKind,
  type CostProfileType,
  Platform,
  ProfitIssueCode,
} from '@pazarsync/db/enums';

import { type ProfitIssue } from '../core/profit-issue';
import {
  type CostProfileVersionInput,
  type ItemCostProfileInput,
} from '../core/seller-costs/build-seller-cost-lines';
import {
  TRENDYOL_SAME_DAY_SHIPPING_TYPE,
  trendyolCategoryBrandKey,
  type CompleteTrendyolFeeParams,
  type OverseasReturnTier,
  type TrendyolBaremBand,
  type TrendyolCommissionRules,
  type TrendyolFeeParams,
  type TrendyolFeeParamsOf,
  type TrendyolOrderCarrierOutcome,
  type TrendyolShippingCarrier,
  type TrendyolShippingTariff,
} from '../marketplaces/trendyol/trendyol-inputs';
import {
  FeeDefinitionNotFoundError,
  findFeeDefinition,
  IncompleteFeeDefinitionError,
  type FeeDefinitionAmountField,
} from '../resolve-fee-definition';
import {
  loadShippingTariffVersion,
  type ShippingTariffVersionRows,
} from '../shipping/tariff-version';

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

/** The cost profile version columns the cost loaders read. */
interface CostProfileVersionRow {
  readonly id: string;
  readonly effectiveFrom: Date;
  readonly version: number;
  readonly amountGross: Prisma.Decimal;
  readonly vatRate: Prisma.Decimal;
  readonly archivedAt: Date | null;
}

/** One cost profile version row -> the pure cost version input (decision 6: the version's effective date). */
function toCostVersion(version: CostProfileVersionRow): CostProfileVersionInput {
  return {
    effectiveFrom: version.effectiveFrom,
    versionNumber: version.version,
    amountGross: dec(version.amountGross),
    vatRatePct: dec(version.vatRate),
    archivedAt: version.archivedAt,
  };
}

/** A cost version input that also carries its row id, so the order snapshot can pin it. */
export interface IdentifiedCostProfileVersionInput extends CostProfileVersionInput {
  readonly id: string;
}

/**
 * A linked cost profile with its version history, each version shaped as `V`, and
 * the instant its link to the variant was made (the cost rule judges both).
 */
interface LoadedCostProfile<V> {
  readonly profileId: string;
  readonly profileType: CostProfileType;
  readonly attachedAt: Date;
  readonly versions: readonly V[];
}

/** A linked cost profile with its full version history and its link instant (the engine's view). */
export type LinkedItemCostProfileInput = LoadedCostProfile<CostProfileVersionInput>;

/** A cost profile whose versions carry their row ids (the order snapshot's view). */
export type IdentifiedItemCostProfileInput = LoadedCostProfile<IdentifiedCostProfileVersionInput>;

/** One cost profile version row -> the cost version input plus its row id. */
function toIdentifiedCostVersion(
  version: CostProfileVersionRow,
): IdentifiedCostProfileVersionInput {
  return { id: version.id, ...toCostVersion(version) };
}

// --- Cost profiles -----------------------------------------------------------

/**
 * The cost profiles linked to the given variants, org-filtered (the link and its
 * profile), each with its link's `attachedAt` and its full version history in
 * (effectiveFrom, version) order, each version mapped by `toVersion`. A profile with
 * no version is dropped: the cost module throws on a versionless profile, so it could
 * never be costed anyway. The result maps only variants that have at least one usable
 * profile.
 */
async function loadCostProfiles<V>(
  tx: Prisma.TransactionClient,
  params: { readonly organizationId: string; readonly variantIds: readonly string[] },
  toVersion: (version: CostProfileVersionRow) => V,
): Promise<Map<string, LoadedCostProfile<V>[]>> {
  const { organizationId } = params;
  const variantIds = [...new Set(params.variantIds)];
  const profilesByVariant = new Map<string, LoadedCostProfile<V>[]>();
  if (variantIds.length === 0) {
    return profilesByVariant;
  }

  const links = await tx.productVariantCostProfile.findMany({
    where: {
      organizationId,
      productVariantId: { in: variantIds },
      profile: { organizationId },
    },
    include: {
      profile: {
        include: { versions: { orderBy: [{ effectiveFrom: 'asc' }, { version: 'asc' }] } },
      },
    },
  });

  for (const link of links) {
    const versions = link.profile.versions.map(toVersion);
    if (versions.length === 0) {
      continue; // a profile with no versions cannot be costed and would break indexing
    }
    const list = profilesByVariant.get(link.productVariantId) ?? [];
    list.push({
      profileId: link.profile.id,
      profileType: link.profile.type,
      attachedAt: link.attachedAt,
      versions,
    });
    profilesByVariant.set(link.productVariantId, list);
  }
  return profilesByVariant;
}

/**
 * The seller cost profiles of every given variant, org-filtered, each with its
 * link's `attachedAt` and its full version history in (effectiveFrom, version)
 * order. A profile with no version is dropped: the cost module throws on a
 * versionless profile, so it could never be costed anyway. The result maps only
 * variants that have at least one usable profile; a variant with none is simply
 * absent from the map.
 */
export async function loadCostProfilesByVariant(
  tx: Prisma.TransactionClient,
  params: { readonly organizationId: string; readonly variantIds: readonly string[] },
): Promise<Map<string, LinkedItemCostProfileInput[]>> {
  return loadCostProfiles(tx, params, toCostVersion);
}

/**
 * The same cost profiles as `loadCostProfilesByVariant` (one query, same filter and
 * order), with each version also carrying its row id. Used by the order profit
 * snapshot to pin the version the cost rule chooses (`chooseOrderCostVersion`).
 */
export async function loadIdentifiedCostProfilesByVariant(
  tx: Prisma.TransactionClient,
  params: { readonly organizationId: string; readonly variantIds: readonly string[] },
): Promise<Map<string, IdentifiedItemCostProfileInput[]>> {
  return loadCostProfiles(tx, params, toIdentifiedCostVersion);
}

/** A cost profile's type and its identified version history, without a link. */
export interface IdentifiedCostProfileHistory {
  readonly profileType: CostProfileType;
  readonly versions: readonly IdentifiedCostProfileVersionInput[];
}

/**
 * The given cost profiles by id, org-filtered, each with its full version history in
 * the same (effectiveFrom, version) order and mapping as
 * `loadIdentifiedCostProfilesByVariant`. Used for profiles whose link to a variant was
 * removed (the removal log names the profile, not a live link). A profile with no
 * version is dropped, as in the link loaders; an id that is not this organization's
 * is absent from the map.
 */
export async function loadIdentifiedCostProfilesById(
  tx: Prisma.TransactionClient,
  params: { readonly organizationId: string; readonly profileIds: readonly string[] },
): Promise<Map<string, IdentifiedCostProfileHistory>> {
  const profileIds = [...new Set(params.profileIds)];
  const byId = new Map<string, IdentifiedCostProfileHistory>();
  if (profileIds.length === 0) {
    return byId;
  }

  const profiles = await tx.costProfile.findMany({
    where: { id: { in: profileIds }, organizationId: params.organizationId },
    include: { versions: { orderBy: [{ effectiveFrom: 'asc' }, { version: 'asc' }] } },
  });
  for (const profile of profiles) {
    const versions = profile.versions.map(toIdentifiedCostVersion);
    if (versions.length === 0) {
      continue; // a profile with no versions cannot be costed and would break indexing
    }
    byId.set(profile.id, { profileType: profile.type, versions });
  }
  return byId;
}

/**
 * The cost profile versions a captured order item was pinned to (order profit
 * snapshot), by version id, org-filtered, in a single query. Each becomes a
 * one-version profile carrying the type stored on that version row (the profile's
 * type when the version was written), not the profile's type today, so the cost
 * module prices the item with exactly that version, whatever its links, newer
 * versions or later type change are. An id that is not this organization's is absent
 * from the map.
 */
export async function loadPinnedCostProfilesByVersionId(
  tx: Prisma.TransactionClient,
  params: { readonly organizationId: string; readonly versionIds: readonly string[] },
): Promise<Map<string, ItemCostProfileInput>> {
  const { organizationId } = params;
  const versionIds = [...new Set(params.versionIds)];
  const profilesByVersionId = new Map<string, ItemCostProfileInput>();
  if (versionIds.length === 0) {
    return profilesByVersionId;
  }

  const versions = await tx.costProfileVersion.findMany({
    where: { id: { in: versionIds }, organizationId },
  });
  for (const version of versions) {
    profilesByVersionId.set(version.id, {
      profileId: version.profileId,
      profileType: version.type,
      versions: [toCostVersion(version)],
    });
  }
  return profilesByVersionId;
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

/** What `loadFeeParams` needs to pick the fee definitions of one order or scenario. */
interface FeeParamsRequest {
  readonly orderDate: Date;
  readonly isExport: boolean;
  readonly fastDeliveryType: string | null;
}

/** A fee definition a parcel uses that is missing on the date or lacks its amount. */
type MissingFeeError = FeeDefinitionNotFoundError | IncompleteFeeDefinitionError;

/**
 * What the fee loader does with a missing or incomplete fee definition, and what it puts
 * in that fee's place: the scenario path throws it (`never`, so its result has every value
 * set), the order path records it as an issue and carries on with `null`.
 */
type MissingFeeHandler<TMissing extends null> = (error: MissingFeeError) => TMissing;

/** The detail of the REFERENCE_DATA_MISSING issue for a fee definition: `FEE:<FeeType>`. */
function missingFeeDetail(feeType: OrderFeeType): string {
  return `FEE:${feeType}`;
}

/** The Trendyol fee definition in force at `at`; `onMissing`'s result when none. */
async function findTrendyolFee<TMissing extends null>(
  tx: Prisma.TransactionClient,
  feeType: OrderFeeType,
  at: Date,
  onMissing: MissingFeeHandler<TMissing>,
): Promise<FeeDefinition | TMissing> {
  const def = await findFeeDefinition(tx, { platform: Platform.TRENDYOL, feeType, at });
  if (def === null) {
    return onMissing(new FeeDefinitionNotFoundError(Platform.TRENDYOL, feeType));
  }
  return def;
}

/**
 * The amount column a used fee needs, as a decimal; the missing value when the
 * definition is missing (`def` is already that value, reported by `findTrendyolFee`) or
 * `onMissing`'s result when it lacks that column.
 */
function feeAmount<TMissing extends null>(
  def: FeeDefinition | TMissing,
  feeType: OrderFeeType,
  field: FeeDefinitionAmountField,
  onMissing: MissingFeeHandler<TMissing>,
): Decimal | TMissing {
  if (def === null) {
    return def;
  }
  const value = def[field];
  if (value === null) {
    return onMissing(new IncompleteFeeDefinitionError(feeType, field));
  }
  return dec(value);
}

/** A definition's default VAT rate as a decimal; the missing value when it is missing. */
function feeVatRate<TMissing extends null>(def: FeeDefinition | TMissing): Decimal | TMissing {
  return def === null ? def : dec(def.defaultVatRate);
}

/** Scales a fraction (0.01) to a percent (1); the missing value stays as it is. */
function toPercent<TMissing extends null>(value: Decimal | TMissing): Decimal | TMissing {
  return value === null ? value : value.mul(PERCENT);
}

/**
 * The fee parameters effective on `orderDate`, reporting every missing or incomplete
 * definition the parcel's kind can use to `onMissing` and putting its result in that
 * fee's place. Every such definition is resolved even after a miss, so each one is
 * reported. The same-day platform service tier is resolved only for a same-day parcel,
 * and the international-service fee and the overseas-return tiers only for an export
 * (micro) parcel; for any other parcel they are unused, so a missing definition must not
 * break it (the same-day net falls back to the standard net, both international rates are
 * zero). Everything else -- platform service, stoppage, commission invoice and shipping --
 * is resolved for every parcel, whether or not this parcel ends up needing it.
 */
async function resolveFeeParams<TMissing extends null>(
  tx: Prisma.TransactionClient,
  params: FeeParamsRequest,
  onMissing: MissingFeeHandler<TMissing>,
): Promise<TrendyolFeeParamsOf<TMissing>> {
  const { orderDate, isExport, fastDeliveryType } = params;

  const psf = await findTrendyolFee(tx, 'PLATFORM_SERVICE', orderDate, onMissing);
  const psfStandardNet = feeAmount(psf, 'PLATFORM_SERVICE', 'fixedAmountNet', onMissing);

  // The same-day tier is used only when the parcel is marked same-day shipping
  // (see estimate-service-fee). For any other parcel the value is unused, so a
  // missing FAST definition must not break it: fall back to the standard net.
  let psfSameDayNet = psfStandardNet;
  if (fastDeliveryType === TRENDYOL_SAME_DAY_SHIPPING_TYPE) {
    const psfFast = await findTrendyolFee(tx, 'PLATFORM_SERVICE_FAST', orderDate, onMissing);
    psfSameDayNet = feeAmount(psfFast, 'PLATFORM_SERVICE_FAST', 'fixedAmountNet', onMissing);
  }

  const stoppage = await findTrendyolFee(tx, 'STOPPAGE', orderDate, onMissing);
  const stoppageRatePct = toPercent(feeAmount(stoppage, 'STOPPAGE', 'rateOfSale', onMissing));
  const commissionInvoice = await findTrendyolFee(tx, 'COMMISSION_INVOICE', orderDate, onMissing);
  const shippingDef = await findTrendyolFee(tx, 'SHIPPING', orderDate, onMissing);

  // The return-shipping VAT follows the SHIPPING definition, exactly as the legacy
  // path does; there is no separate return-shipping rate to resolve here.
  const shippingVatRatePct = feeVatRate(shippingDef);

  let internationalServiceRatePct: Decimal | TMissing = ZERO;
  let internationalServiceVatRatePct: Decimal | TMissing = ZERO;
  let overseasReturnTiers: readonly OverseasReturnTier[] = [];
  if (isExport) {
    const intl = await findTrendyolFee(tx, 'INTERNATIONAL_SERVICE', orderDate, onMissing);
    internationalServiceRatePct = toPercent(
      feeAmount(intl, 'INTERNATIONAL_SERVICE', 'rateOfSale', onMissing),
    );
    internationalServiceVatRatePct = feeVatRate(intl);
    overseasReturnTiers = await loadOverseasReturnTiers(tx, orderDate);
  }

  return {
    psfStandardNet,
    psfSameDayNet,
    psfVatRatePct: feeVatRate(psf),
    stoppageRatePct,
    commissionVatRatePct: feeVatRate(commissionInvoice),
    shippingVatRatePct,
    returnShippingVatRatePct: shippingVatRatePct,
    internationalServiceRatePct,
    internationalServiceVatRatePct,
    overseasReturnTiers,
  };
}

/** Rethrows a missing fee as the scenario path always has. */
function throwMissingFee(error: MissingFeeError): never {
  throw error;
}

/**
 * The fee parameters effective on `orderDate` for a scenario (no stored order). A fee
 * definition the scenario uses that is missing throws `FeeDefinitionNotFoundError`, one
 * lacking its amount `IncompleteFeeDefinitionError`; the caller degrades the screen
 * (see `loadTrendyolScenarioBases`). Every value is therefore set, and the type says so:
 * the handler returns `never`, so a handler that stopped throwing would no longer
 * compile against `CompleteTrendyolFeeParams`.
 */
export async function loadFeeParams(
  tx: Prisma.TransactionClient,
  params: FeeParamsRequest,
): Promise<CompleteTrendyolFeeParams> {
  return resolveFeeParams(tx, params, throwMissingFee);
}

/**
 * The fee parameters effective on a stored order's date. Unlike `loadFeeParams` it never
 * throws on reference data: each missing or incomplete definition it resolves adds one
 * blocking REFERENCE_DATA_MISSING issue (`detail` `FEE:<FeeType>`) to `issues` and leaves
 * that fee's values null, so the engine writes no line that needs it and the order's
 * statement is still written (not computable).
 *
 * The definitions resolved are those the parcel's kind can use (see `resolveFeeParams`),
 * not only those this parcel ends up needing: platform service, stoppage, commission
 * invoice and shipping are resolved for every parcel. This is a deliberate limit: a
 * missing definition for a fee the parcel would not use still makes the order not
 * computable (an export parcel carries no platform service fee or stoppage, an
 * all-digital parcel does not ship, yet both block on those definitions).
 */
export async function loadOrderFeeParams(
  tx: Prisma.TransactionClient,
  params: FeeParamsRequest & { readonly issues: ProfitIssue[] },
): Promise<TrendyolFeeParams> {
  const reported = new Set<OrderFeeType>();
  return resolveFeeParams(tx, params, (error): null => {
    if (reported.has(error.feeType)) {
      return null;
    }
    reported.add(error.feeType);
    params.issues.push({
      code: ProfitIssueCode.REFERENCE_DATA_MISSING,
      orderItemId: null,
      detail: missingFeeDetail(error.feeType),
    });
    return null;
  });
}

/**
 * The micro-export return-fee tiers in force on the order date, rate scaled to a
 * percent: the bands of the latest tier version starting on or before the date. A
 * band dropped from a later version no longer applies once that version starts. No
 * version yet means no tiers.
 */
async function loadOverseasReturnTiers(
  tx: Prisma.TransactionClient,
  orderDate: Date,
): Promise<OverseasReturnTier[]> {
  const version = await tx.microExportReturnFeeTierVersion.findFirst({
    where: { effectiveFrom: { lte: orderDate } },
    orderBy: { effectiveFrom: 'desc' },
    include: { tiers: { orderBy: { minSaleGross: 'asc' } } },
  });
  if (version === null) {
    return [];
  }
  return version.tiers.map((row) => ({
    minUnitSaleGross: dec(row.minSaleGross),
    maxUnitSaleGross: dec(row.maxSaleGross),
    ratePct: dec(row.rate).mul(PERCENT),
  }));
}

// --- Shipping ----------------------------------------------------------------

/**
 * The shipping tariff mirror of resolve-tariff.ts: the carrier's tariff version in
 * force at `at` (desi prices, Barem bands, Barem attributes) and the store's own rows.
 * Loads the version, then builds the tariff from it (`buildShippingTariff`).
 */
export async function loadShippingTariff(
  tx: Prisma.TransactionClient,
  params: {
    readonly storeId: string;
    readonly source: TrendyolShippingTariff['source'];
    readonly carrier: { readonly id: string; readonly code: string } | null;
    // The instant whose tariff version applies: the order date, or the scenario date.
    readonly at: Date;
    // How the order's carrier resolved; omitted (null) for the scenario / store-default
    // context, where the carrier field alone decides.
    readonly orderCarrierOutcome?: TrendyolOrderCarrierOutcome | null;
  },
): Promise<TrendyolShippingTariff> {
  const { storeId, source, carrier, at } = params;
  const version =
    carrier === null ? null : await loadShippingTariffVersion(tx, { carrierId: carrier.id, at });
  return buildShippingTariff(tx, {
    storeId,
    source,
    carrier,
    version,
    orderCarrierOutcome: params.orderCarrierOutcome,
  });
}

/**
 * Builds the shipping tariff from an already loaded carrier tariff version and the
 * store's own rows (read here). A caller that also needs the version's Barem window
 * loads the version once and passes the same object to both, so the prices and the
 * window always come from one version.
 */
export async function buildShippingTariff(
  tx: Prisma.TransactionClient,
  params: {
    readonly storeId: string;
    readonly source: TrendyolShippingTariff['source'];
    readonly carrier: { readonly code: string } | null;
    // The carrier's version in force at the relevant instant; null when there is no
    // carrier or no version in force.
    readonly version: ShippingTariffVersionRows | null;
    // How the order's carrier resolved; omitted (null) for the scenario / store-default
    // context, where the carrier field alone decides.
    readonly orderCarrierOutcome?: TrendyolOrderCarrierOutcome | null;
  },
): Promise<TrendyolShippingTariff> {
  const { storeId, source, carrier, version } = params;
  const orderCarrierOutcome = params.orderCarrierOutcome ?? null;

  let carrierInput: TrendyolShippingCarrier | null = null;
  const desiTariffNet = new Map<string, Decimal>();
  let baremBands: TrendyolBaremBand[] = [];

  if (carrier !== null) {
    // With no version in force (no tariff entered yet, or a date before its first
    // version) the carrier offers no Barem, its tariffs stay empty and the tariff is
    // flagged `tariffVersionMissing`, so a Trendyol-contract estimate is unavailable
    // (NO_TARIFF_VERSION) instead of a silent 0 TL.
    carrierInput = {
      code: carrier.code,
      supportsBarem: version !== null && version.supportsBaremDestek,
      maxBaremDesi: new Decimal(version === null ? 0 : version.maxBaremDesi),
      baremAppliesToReturns: version !== null && version.baremAppliesToReturns,
    };
    if (version !== null) {
      for (const row of version.desiRows) {
        desiTariffNet.set(row.desi.toString(), dec(row.priceNet));
      }
      baremBands = version.baremRows.map((row) => ({
        tier: row.tier,
        minOrderAmount: dec(row.minOrderAmount),
        maxOrderAmount: dec(row.maxOrderAmount),
        priceNet: dec(row.priceNet),
      }));
    }
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
    tariffVersionMissing: carrier !== null && version === null,
  };
}
