import { type Decimal } from 'decimal.js';
import {
  CostProfileType,
  FxRateMode,
  FxRateSource,
  ProfitIssueCode,
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
} from '@pazarsync/db/enums';

import { COST_PROFILE_LINE_TYPE } from '../catalog/cost-profile-line-type';
import { convertLineMoney } from '../fx/convert-line-money';
import { CURRENCY_TRY, type CurrencyCode } from '../fx/currency-code';
import { type FxRateQuote, type SelectedFxRate, selectFxRate } from '../fx/select-fx-rate';
import { activeItems, type ParcelItemSnapshot, type ParcelSnapshot } from '../parcel-snapshot';
import {
  createProfitLine,
  type FxConversion,
  type LineMoney,
  nativeFx,
  type ProfitLine,
} from '../profit-line';
import { type ProfitIssue } from '../profit-issue';
import { vatFromGross } from '../../tax/tr/vat';

/** One version of a seller cost profile, as it stood at a point in time. */
export interface CostProfileVersionInput {
  readonly effectiveFrom: Date;
  readonly amountGross: Decimal; // per unit, in `currency`
  readonly currency: CurrencyCode;
  readonly vatRatePct: Decimal;
  readonly fxRateMode: FxRateMode; // Prisma enum: AUTO | MANUAL
  readonly manualFxRate: Decimal | null;
  readonly archivedAt: Date | null; // version snapshot: non-null = the profile is archived from this version on
}

/** A seller cost profile attached to an order item, with its full version history. */
export interface ItemCostProfileInput {
  readonly profileId: string;
  readonly profileType: CostProfileType;
  readonly versions: readonly CostProfileVersionInput[];
}

/** The seller cost profiles that apply to one order item. */
export interface ItemCostInput {
  readonly orderItemId: string;
  readonly profiles: readonly ItemCostProfileInput[];
}

/** Either a converted amount or a missing-rate signal for one cost profile. */
type CostFxResult =
  | { readonly kind: 'ok'; readonly amount: LineMoney; readonly fx: FxConversion }
  | { readonly kind: 'missing-fx'; readonly detail: string };

/**
 * Chooses the version that applies at `orderDate`: the latest version whose
 * `effectiveFrom` is on or before the order date. When no version qualifies the
 * earliest version is used (the first-version rule, design section 6.6).
 */
function chooseCostVersion(
  versions: readonly CostProfileVersionInput[],
  orderDate: Date,
): CostProfileVersionInput {
  const orderTime = orderDate.getTime();
  let latestApplicable: CostProfileVersionInput | null = null;
  let earliest: CostProfileVersionInput | null = null;
  for (const version of versions) {
    const effectiveTime = version.effectiveFrom.getTime();
    if (earliest === null || effectiveTime < earliest.effectiveFrom.getTime()) {
      earliest = version;
    }
    if (
      effectiveTime <= orderTime &&
      (latestApplicable === null || effectiveTime > latestApplicable.effectiveFrom.getTime())
    ) {
      latestApplicable = version;
    }
  }
  const chosen = latestApplicable ?? earliest;
  if (chosen === null) {
    throw new RangeError('a cost profile must have at least one version');
  }
  return chosen;
}

/** Picks the rate for a non-native cost version, or null when none applies. */
function selectCostFxRate(params: {
  readonly version: CostProfileVersionInput;
  readonly snapshot: ParcelSnapshot;
  readonly fxQuotes: readonly FxRateQuote[];
}): SelectedFxRate | null {
  const { version, snapshot, fxQuotes } = params;
  switch (version.fxRateMode) {
    case FxRateMode.MANUAL: {
      const rate = version.manualFxRate;
      if (rate === null || !rate.isFinite() || rate.lte(0)) {
        return null;
      }
      return { rate, rateDate: null, source: FxRateSource.MANUAL };
    }
    case FxRateMode.AUTO:
      return selectFxRate({
        from: version.currency,
        to: snapshot.accountingCurrency,
        eventDate: snapshot.businessDate,
        base: CURRENCY_TRY,
        quotes: fxQuotes,
        quoteSource: FxRateSource.TCMB,
      });
    default: {
      const exhaustive: never = version.fxRateMode;
      throw new Error(`Unhandled fx rate mode: ${exhaustive}`);
    }
  }
}

/** Builds the `MISSING_FX_RATE` detail string for a non-native cost version. */
function missingFxDetail(version: CostProfileVersionInput): string {
  return version.fxRateMode === FxRateMode.MANUAL ? `MANUAL:${version.currency}` : version.currency;
}

/** Converts the per-item cost amount into the accounting currency. */
function resolveCostFx(params: {
  readonly original: LineMoney;
  readonly version: CostProfileVersionInput;
  readonly snapshot: ParcelSnapshot;
  readonly fxQuotes: readonly FxRateQuote[];
}): CostFxResult {
  const { original, version, snapshot, fxQuotes } = params;

  if (version.currency === snapshot.accountingCurrency) {
    return { kind: 'ok', amount: original, fx: nativeFx(original, version.currency) };
  }

  const selected = selectCostFxRate({ version, snapshot, fxQuotes });
  if (selected === null) {
    return { kind: 'missing-fx', detail: missingFxDetail(version) };
  }
  const converted = convertLineMoney(original, version.currency, selected);
  return { kind: 'ok', amount: converted.amount, fx: converted.fx };
}

/**
 * Indexes the cost entries by order item id, rejecting loader bugs: an entry for
 * an item that is not in the parcel, two entries for the same item, and a profile
 * with no versions. Each throws `RangeError`.
 */
function indexCosts(
  snapshot: ParcelSnapshot,
  costs: readonly ItemCostInput[],
): ReadonlyMap<string, ItemCostInput> {
  const itemIds = new Set(snapshot.items.map((item) => item.orderItemId));
  const byItemId = new Map<string, ItemCostInput>();
  for (const entry of costs) {
    if (!itemIds.has(entry.orderItemId)) {
      throw new RangeError(
        `cost entry orderItemId '${entry.orderItemId}' is not an item of the parcel`,
      );
    }
    if (byItemId.has(entry.orderItemId)) {
      throw new RangeError(
        `cost entry orderItemId '${entry.orderItemId}' is listed more than once`,
      );
    }
    for (const profile of entry.profiles) {
      if (profile.versions.length === 0) {
        throw new RangeError(`cost profile '${profile.profileId}' has no versions`);
      }
    }
    byItemId.set(entry.orderItemId, entry);
  }
  return byItemId;
}

/** Builds the cost lines for one active item, pushing issues onto `issues`. */
function buildItemCostLines(params: {
  readonly item: ParcelItemSnapshot;
  readonly entry: ItemCostInput;
  readonly snapshot: ParcelSnapshot;
  readonly fxQuotes: readonly FxRateQuote[];
  readonly issues: ProfitIssue[];
}): { readonly lines: ProfitLine[]; readonly costed: boolean } {
  const { item, entry, snapshot, fxQuotes, issues } = params;
  const lines: ProfitLine[] = [];
  let costed = false;

  for (const profile of entry.profiles) {
    const version = chooseCostVersion(profile.versions, snapshot.orderDate);
    if (version.archivedAt !== null) {
      continue; // archived at the order date: not usable, contributes nothing
    }
    costed = true;

    const grossOriginal = version.amountGross.mul(item.quantity);
    if (grossOriginal.isZero()) {
      continue; // a zero-amount profile still counts as costed but writes no line
    }
    const original: LineMoney = {
      gross: grossOriginal,
      vat: vatFromGross(grossOriginal, version.vatRatePct),
    };

    const fxResult = resolveCostFx({ original, version, snapshot, fxQuotes });
    if (fxResult.kind === 'missing-fx') {
      issues.push({
        code: ProfitIssueCode.MISSING_FX_RATE,
        orderItemId: item.orderItemId,
        detail: fxResult.detail,
      });
      continue;
    }

    lines.push(
      createProfitLine({
        type: COST_PROFILE_LINE_TYPE[profile.profileType],
        level: ProfitLineLevel.ITEM,
        orderItemId: item.orderItemId,
        certainty: ProfitLineCertainty.ACTUAL,
        source: ProfitLineSource.SELLER_INPUT,
        amount: fxResult.amount,
        vatRatePct: version.vatRatePct,
        fx: fxResult.fx,
        inputs: {
          profileId: profile.profileId,
          profileType: profile.profileType,
          versionEffectiveFrom: version.effectiveFrom.toISOString(),
        },
        externalRecord: null,
      }),
    );
  }

  return { lines, costed };
}

/**
 * Builds the seller cost lines for a parcel from its cost profiles. For each
 * active item, the version valid at the order date is chosen per profile, its
 * archived state is read from that version, and the amount is converted into the
 * accounting currency at the business-date rate. An active item with no cost
 * entry, or whose every chosen version is archived, yields a `MISSING_COST`
 * issue; a missing rate yields `MISSING_FX_RATE`. Lines come in snapshot item
 * order then profile input order; issues come in item order.
 */
export function buildSellerCostLines(params: {
  readonly snapshot: ParcelSnapshot;
  readonly costs: readonly ItemCostInput[];
  readonly fxQuotes: readonly FxRateQuote[];
}): { readonly lines: ProfitLine[]; readonly issues: ProfitIssue[] } {
  const { snapshot, costs, fxQuotes } = params;
  const costByItemId = indexCosts(snapshot, costs);

  const lines: ProfitLine[] = [];
  const issues: ProfitIssue[] = [];

  for (const item of activeItems(snapshot)) {
    const entry = costByItemId.get(item.orderItemId);
    if (entry === undefined) {
      issues.push({
        code: ProfitIssueCode.MISSING_COST,
        orderItemId: item.orderItemId,
        detail: null,
      });
      continue;
    }

    const result = buildItemCostLines({ item, entry, snapshot, fxQuotes, issues });
    lines.push(...result.lines);
    if (!result.costed) {
      issues.push({
        code: ProfitIssueCode.MISSING_COST,
        orderItemId: item.orderItemId,
        detail: null,
      });
    }
  }

  return { lines, issues };
}
