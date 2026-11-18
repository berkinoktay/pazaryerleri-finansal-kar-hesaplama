// Shared core for every "what if I price this product here?" scenario screen.
//
// Each screen (product pricing, commission tariff, Plus, advantage, flash, discount,
// campaign) picks its own band/rate and hands it to the scenario engine as a
// commission override; this module owns the three steps they all repeat:
//   1. load the per-variant scenario bases for a whole request in one pass
//      (`loadScreenScenarioBases`), degrading rather than throwing (decision 9);
//   2. evaluate ONE (price, commission override) against a loaded base
//      (`evaluateScreenScenario`), mapping the statement's issues to the wire reason;
//   3. serialize the two display numbers every screen shows (`formatMoney2`,
//      `formatMarginPct2`).
// No financial math lives here -- the engine (`@pazarsync/profit`) owns every formula
// (feedback_no_frontend_financial_calculation).

import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';
import { Platform, ProfitIssueCode } from '@pazarsync/db/enums';
import {
  evaluateTrendyolScenario,
  isBlockingIssue,
  loadCommissionRulesForCategories,
  loadTrendyolScenarioBases,
  resolveTrendyolCategoryRate,
  roundPercent,
  UnsupportedPlatformError,
  type ProfitIssue,
  type ProfitStatement,
  type ScenarioLoadResult,
  type StoredTariffBand,
  type TrendyolScenarioBase,
} from '@pazarsync/profit';

import { resolveVariantIdsByBarcode } from '../lib/variant-barcode-lookup';
import { logProfitReadFailure, type ProfitReadSurface } from './profit-compute-fallback.service';
import { type TariffItemReason } from './tariff-compute-commons';

// --- Category-rate fallback (the chain's last tier) ---

/** A product's category and brand ids, the inputs of the category-rate fallback. */
export interface CategoryRateRef {
  readonly categoryId: bigint | null;
  readonly brandId: bigint | null;
}

/** Category-rate cache key -- the same shape at every scenario screen. */
export function categoryRateKey(categoryId: bigint, brandId: bigint | null): string {
  return `${categoryId}:${brandId ?? 'null'}`;
}

/**
 * The category-fallback commission rate of every distinct (category, brand) pair among
 * `refs`, keyed by `categoryRateKey`, from ONE rule load for the whole screen. The
 * commission rule table is Trendyol reference data, so another marketplace's store gets
 * an empty map (no category fallback rate). Refs without a category are skipped.
 */
export async function resolveCategoryRatesByKey(params: {
  readonly platform: Platform;
  readonly refs: Iterable<CategoryRateRef>;
}): Promise<ReadonlyMap<string, Decimal | null>> {
  const { platform, refs } = params;
  const categoryRateByKey = new Map<string, Decimal | null>();
  if (platform !== Platform.TRENDYOL) return categoryRateByKey;

  const distinct = new Map<string, { categoryId: bigint; brandId: bigint | null }>();
  for (const { categoryId, brandId } of refs) {
    if (categoryId === null) continue;
    distinct.set(categoryRateKey(categoryId, brandId), { categoryId, brandId });
  }
  if (distinct.size === 0) return categoryRateByKey;

  const rules = await loadCommissionRulesForCategories(prisma, {
    categoryIds: [...distinct.values()].map((ref) => ref.categoryId),
  });
  for (const [key, { categoryId, brandId }] of distinct) {
    const resolved = resolveTrendyolCategoryRate({
      rules,
      categoryId: categoryId.toString(),
      brandId: brandId === null ? null : brandId.toString(),
    });
    categoryRateByKey.set(key, resolved?.ratePct ?? null);
  }
  return categoryRateByKey;
}

/** The category-fallback commission rate of one product; null when none applies. */
export async function resolveCategoryRate(params: {
  readonly platform: Platform;
  readonly ref: CategoryRateRef | null;
}): Promise<Decimal | null> {
  const { platform, ref } = params;
  if (ref === null || ref.categoryId === null) return null;
  const rates = await resolveCategoryRatesByKey({ platform, refs: [ref] });
  return rates.get(categoryRateKey(ref.categoryId, ref.brandId)) ?? null;
}

// --- Per-item scenario base ---

/** How one tariff/campaign item reaches the engine. */
export type ScreenScenarioBase =
  | { readonly kind: 'ready'; readonly base: TrendyolScenarioBase }
  // The item's barcode resolved to no catalog variant at read time
  // (`resolveScreenVariantIds`), or the loader's VARIANT_NOT_FOUND.
  | { readonly kind: 'no-product' }
  // The barcode lookup or the store-wide scenario-base load failed (already logged).
  | { readonly kind: 'degraded' };

/** The outcome of one read's barcode lookup (`resolveScreenVariantIds`). */
export interface ScreenVariantResolution {
  /** Each item barcode's catalog variant id; a barcode with no variant is absent. */
  readonly variantIdByBarcode: ReadonlyMap<string, string>;
  /**
   * True when the lookup failed (already logged): the map is then empty, and every item
   * of the read is `degraded`, never `no-product` -- the products may well exist.
   */
  readonly degraded: boolean;
}

/**
 * The catalog variant id of each item barcode of one read, as the catalog is NOW, in one
 * query (`resolveVariantIdsByBarcode`: exact barcode, scoped to the organization and the
 * store; among variants sharing a barcode one still in the feed beats a delisted one,
 * then the oldest wins). A barcode with no variant is absent from the map. Every campaign
 * screen resolves its items through this instead of the item's stored
 * product_variant_id, which is only an import-time snapshot, so an item uploaded before
 * its product was synced, or whose variant was recreated, is priced without a re-upload.
 *
 * Decision 9 (the page always opens): a failed lookup never throws out of here. It logs
 * once (`[profit-read]`, the given surface, no order id) and returns an empty map marked
 * `degraded`; the caller then skips its per-variant reads and gives every item the
 * `degraded` base, as for a failed `loadScreenScenarioBases`.
 */
export async function resolveScreenVariantIds(params: {
  readonly organizationId: string;
  readonly storeId: string;
  readonly barcodes: Iterable<string>;
  readonly surface: ProfitReadSurface;
}): Promise<ScreenVariantResolution> {
  try {
    const variantIdByBarcode = await resolveVariantIdsByBarcode(
      prisma,
      { organizationId: params.organizationId, storeId: params.storeId },
      params.barcodes,
    );
    return { variantIdByBarcode, degraded: false };
  } catch (err) {
    logProfitReadFailure({
      surface: params.surface,
      organizationId: params.organizationId,
      orderId: null,
      err,
    });
    return { variantIdByBarcode: new Map<string, string>(), degraded: true };
  }
}

/**
 * The single-item form of `resolveScreenVariantIds`, for the estimate services: the
 * catalog variant id of one item barcode (null when no variant carries it), and whether
 * the lookup failed (logged once; `variantId` is then null and the item is `degraded`).
 */
export async function resolveScreenVariantId(params: {
  readonly organizationId: string;
  readonly storeId: string;
  readonly barcode: string;
  readonly surface: ProfitReadSurface;
}): Promise<{ readonly variantId: string | null; readonly degraded: boolean }> {
  const { variantIdByBarcode, degraded } = await resolveScreenVariantIds({
    organizationId: params.organizationId,
    storeId: params.storeId,
    barcodes: [params.barcode],
    surface: params.surface,
  });
  return { variantId: variantIdByBarcode.get(params.barcode) ?? null, degraded };
}

/**
 * Loads the scenario base of every given variant for one store in a single pass. These
 * screens pass their own rate as the engine's commission override, so the engine never
 * resolves a tariff band itself. The cost version and fee definitions are read at
 * `scenarioDate`.
 *
 * Decision 9 (the page always opens): a store-wide loader failure never throws out of
 * here. A non-Trendyol store (`UnsupportedPlatformError`) returns null WITHOUT a log --
 * an expected, non-error case, exactly as the order read path treats it. Any other
 * failure logs once (`[profit-read]`, the given surface, no order id) and returns null.
 * An empty id list is an empty Map and issues no query; ids are deduped by the loader.
 */
export async function loadScreenScenarioBases(params: {
  readonly organizationId: string;
  readonly storeId: string;
  readonly scenarioDate: Date;
  readonly variantIds: readonly string[];
  readonly surface: ProfitReadSurface;
}): Promise<ReadonlyMap<string, ScenarioLoadResult> | null> {
  const variantIds = [...new Set(params.variantIds)];
  if (variantIds.length === 0) {
    return new Map<string, ScenarioLoadResult>();
  }
  try {
    return await loadTrendyolScenarioBases(prisma, {
      organizationId: params.organizationId,
      storeId: params.storeId,
      scenarioDate: params.scenarioDate,
      variants: variantIds.map((variantId) => ({ variantId })),
    });
  } catch (err) {
    if (err instanceof UnsupportedPlatformError) {
      return null;
    }
    logProfitReadFailure({
      surface: params.surface,
      organizationId: params.organizationId,
      orderId: null,
      err,
    });
    return null;
  }
}

/**
 * The `ScreenScenarioBase` for one item. `variantId` is the id its barcode resolved to at
 * read time (`resolveScreenVariantIds`), null when the barcode matched no catalog
 * variant. `no-product` when that id is null or the loader marked it unavailable
 * (VARIANT_NOT_FOUND); `degraded` when the read's barcode lookup failed
 * (`lookupDegraded`, from `resolveScreenVariantIds` / `resolveScreenVariantId`, already
 * logged; checked first, since such a read has no ids) or the store-wide load failed
 * (`bases` is null, already logged); otherwise `ready` with the loaded base. Every campaign
 * screen goes through here, so one unit test covers the degraded rule for all of them.
 */
export function screenScenarioBaseFor(
  bases: ReadonlyMap<string, ScenarioLoadResult> | null,
  variantId: string | null,
  lookupDegraded: boolean,
): ScreenScenarioBase {
  // A failed barcode lookup (already logged) leaves every item without an id; it must read
  // as degraded, never as no-product, so it is checked before the id.
  if (lookupDegraded) {
    return { kind: 'degraded' };
  }
  if (variantId === null) {
    return { kind: 'no-product' };
  }
  if (bases === null) {
    return { kind: 'degraded' };
  }
  const loaded = bases.get(variantId);
  if (loaded === undefined || loaded.kind === 'unavailable') {
    return { kind: 'no-product' };
  }
  return { kind: 'ready', base: loaded.base };
}

// --- One scenario evaluation ---

export type ScreenScenarioOutcome =
  | { readonly calculable: true; readonly statement: ProfitStatement; readonly netProfit: Decimal }
  | { readonly calculable: false; readonly reason: TariffItemReason | null };

/**
 * Maps an evaluated statement's issues to the screen's not-calculable reason. Cost gates
 * first (a margin at cost=0 would be wrong), the legacy cost-first order: a
 * MISSING_COST wins as NO_COST, else a SHIPPING_ESTIMATE_UNAVAILABLE is NO_SHIPPING, else
 * there is no reason. MISSING_COMMISSION_RATE cannot occur here (every screen passes a
 * commission override); `evaluateScreenScenario`'s defensive branch still covers it.
 */
export function scenarioReasonFromIssues(issues: readonly ProfitIssue[]): TariffItemReason | null {
  if (issues.some((issue) => issue.code === ProfitIssueCode.MISSING_COST)) {
    return 'NO_COST';
  }
  if (issues.some((issue) => issue.code === ProfitIssueCode.SHIPPING_ESTIMATE_UNAVAILABLE)) {
    return 'NO_SHIPPING';
  }
  return null;
}

/**
 * Evaluates one scenario: the base at `unitPrice` with `commissionPct` applied as the
 * engine's commission override (verbatim, zero included). `quantity` defaults to the
 * base's quantity (one); a basket/order scope passes n, and the engine then prices
 * `unitPrice x quantity` with n cost units but a single shipping and platform-service fee
 * per parcel (decision 6). A mapped issue reason (NO_COST / NO_SHIPPING) makes it
 * not-calculable; a null net profit or any other blocking issue is a defensive
 * not-calculable with no reason. The engine may throw (e.g. a RangeError for a negative
 * price) -- that PROPAGATES; the calling service catches it per item and degrades that row.
 */
export function evaluateScreenScenario(params: {
  readonly base: TrendyolScenarioBase;
  readonly unitPrice: Decimal;
  readonly commissionPct: Decimal;
  readonly quantity?: number;
}): ScreenScenarioOutcome {
  const { statement } = evaluateTrendyolScenario({
    ...params.base,
    unitPrice: params.unitPrice,
    commissionRatePctOverride: params.commissionPct,
    quantity: params.quantity ?? params.base.quantity,
  });

  const reason = scenarioReasonFromIssues(statement.issues);
  if (reason !== null) {
    return { calculable: false, reason };
  }

  const netProfit = statement.netProfit;
  if (netProfit === null || statement.issues.some(isBlockingIssue)) {
    return { calculable: false, reason: null };
  }

  return { calculable: true, statement, netProfit };
}

/**
 * The item reason a screen reports from one option's evaluation when the options alone
 * decide its calculability (no current baseline to gate on): the reason of a
 * not-calculable outcome, else null (calculable, or nothing was evaluated).
 */
export function outcomeReason(
  outcome: ScreenScenarioOutcome | null | undefined,
): TariffItemReason | null {
  if (outcome === null || outcome === undefined || outcome.calculable) return null;
  return outcome.reason;
}

// --- Serialization (shared with product pricing) ---

/** One commission band serialized for the wire: price limits 2dp, percent 4dp. */
export interface SerializedCommissionBand {
  readonly lowerLimit: string | null;
  readonly upperLimit: string | null;
  readonly commissionPct: string;
}

/**
 * Serializes a resolved commission-band ladder for the wire the single way every screen
 * shows it (advantage / flash / discount popover): a price limit at two decimals or null
 * when open-ended, the percent at four decimals. The caller keeps the null-in / null-out
 * guard (no ladder -> null) so this never has to invent an empty ladder.
 */
export function serializeCommissionBandLadder(
  bands: readonly StoredTariffBand[],
): SerializedCommissionBand[] {
  return bands.map((band) => ({
    lowerLimit: band.lowerLimit !== null ? new Decimal(band.lowerLimit).toFixed(2) : null,
    upperLimit: band.upperLimit !== null ? new Decimal(band.upperLimit).toFixed(2) : null,
    commissionPct: new Decimal(band.commissionPct).toFixed(4),
  }));
}

/**
 * Rounds a full-precision taxed base (matrah) to the kurus, half-up -- the unit price the
 * discount and campaign screens hand the engine (decision 6). The band-lookup price keeps
 * its own rounding at the call site; this only rounds the engine's revenue input.
 */
export function toKurusHalfUp(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** A two-decimal money string (half-up), signed zero normalized to a plain zero. */
export function formatMoney2(value: Decimal): string {
  const fixed = value.toFixed(2, Decimal.ROUND_HALF_UP);
  return fixed === '-0.00' ? '0.00' : fixed;
}

/**
 * A margin as a two-decimal string, rounded the way the stored statement rounds it
 * (roundPercent to the stored scale first, then two decimals) so a screen renders the
 * same value the order list and the stored row do. Null stays null; signed zero is
 * normalized to a plain zero.
 */
export function formatMarginPct2(value: Decimal | null): string | null {
  if (value === null) {
    return null;
  }
  const fixed = roundPercent(value).toFixed(2, Decimal.ROUND_HALF_UP);
  return fixed === '-0.00' ? '0.00' : fixed;
}

// --- Per-request failure log (collect then log once) ---

/**
 * Collects per-item compute failures across one request and logs them once. A list that
 * computes many rows calls `record(err)` for each failing row, then `flush()` after the
 * pass writes a single `[profit-read]` line with the first error and the failed count --
 * so a systemic failure on a large list is one log line, not one per row (the pattern
 * product pricing's list uses; decision 9).
 */
export interface RequestFailureLog {
  /** Counts one failure; the first one (and its order id, when known) is what gets logged. */
  record(err: unknown, orderId?: string): void;
  flush(): void;
}

export function createRequestFailureLog(params: {
  readonly surface: ProfitReadSurface;
  readonly organizationId: string;
}): RequestFailureLog {
  let firstError: unknown = null;
  let firstOrderId: string | null = null;
  let failedCount = 0;
  return {
    record(err: unknown, orderId?: string): void {
      if (failedCount === 0) {
        firstError = err;
        firstOrderId = orderId ?? null;
      }
      failedCount += 1;
    },
    flush(): void {
      if (failedCount === 0) {
        return;
      }
      logProfitReadFailure({
        surface: params.surface,
        organizationId: params.organizationId,
        orderId: firstOrderId,
        err: firstError,
        failedCount,
      });
    },
  };
}
