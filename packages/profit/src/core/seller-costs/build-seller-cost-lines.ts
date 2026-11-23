import { type Decimal } from 'decimal.js';
import {
  CostProfileType,
  ProfitIssueCode,
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
} from '@pazarsync/db/enums';

import { COST_PROFILE_LINE_TYPE } from '../catalog/cost-profile-line-type';
import { activeItems, type ParcelItemSnapshot, type ParcelSnapshot } from '../parcel-snapshot';
import { createProfitLine, type LineMoney, type ProfitLine } from '../profit-line';
import { type ProfitIssue } from '../profit-issue';
import { vatFromGross } from '../../tax/tr/vat';
import { latestVersionAt, versionPrecedes } from './cost-version-order';

/** One version of a seller cost profile, as it stood at a point in time. All amounts are in Turkish lira. */
export interface CostProfileVersionInput {
  readonly effectiveFrom: Date;
  readonly versionNumber: number; // orders versions: the higher number is the newer version
  readonly amountGross: Decimal; // per unit, in Turkish lira
  readonly vatRatePct: Decimal;
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

/**
 * Chooses the version that applies at `orderDate`: the version in force then
 * (`latestVersionAt`, the highest version number among those whose `effectiveFrom`
 * is on or before the order date; amendment A11). When none qualifies the oldest
 * version by the same order is used (the first-version rule, design section 6.6).
 * Throws `RangeError` on an empty list.
 *
 * Generic so a caller can keep its own version element; the chosen element is
 * returned as passed in.
 */
export function chooseCostVersion<T extends CostProfileVersionInput>(
  versions: readonly T[],
  orderDate: Date,
): T {
  const applicable = latestVersionAt(versions, orderDate);
  if (applicable !== null) return applicable;
  let earliest: T | null = null;
  for (const version of versions) {
    if (earliest === null || versionPrecedes(version, earliest)) {
      earliest = version;
    }
  }
  if (earliest === null) {
    throw new RangeError('a cost profile must have at least one version');
  }
  return earliest;
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

/** Builds the cost lines for one active item. */
function buildItemCostLines(params: {
  readonly item: ParcelItemSnapshot;
  readonly entry: ItemCostInput;
  readonly snapshot: ParcelSnapshot;
}): { readonly lines: ProfitLine[]; readonly costed: boolean } {
  const { item, entry, snapshot } = params;
  const lines: ProfitLine[] = [];
  let costed = false;

  for (const profile of entry.profiles) {
    const version = chooseCostVersion(profile.versions, snapshot.orderDate);
    if (version.archivedAt !== null) {
      continue; // archived at the order date: not usable, contributes nothing
    }
    costed = true;

    const gross = version.amountGross.mul(item.quantity);
    if (gross.isZero()) {
      continue; // a zero-amount profile still counts as costed but writes no line
    }
    const amount: LineMoney = {
      gross,
      vat: vatFromGross(gross, version.vatRatePct),
    };

    lines.push(
      createProfitLine({
        type: COST_PROFILE_LINE_TYPE[profile.profileType],
        level: ProfitLineLevel.ITEM,
        orderItemId: item.orderItemId,
        certainty: ProfitLineCertainty.ACTUAL,
        source: ProfitLineSource.SELLER_INPUT,
        amount,
        vatRatePct: version.vatRatePct,
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
 * archived state is read from that version, and the amount is the version's
 * per-unit lira amount times the item quantity. An active item with no cost entry,
 * or whose every chosen version is archived, yields a `MISSING_COST` issue. Lines
 * come in snapshot item order then profile input order; issues come in item order.
 */
export function buildSellerCostLines(params: {
  readonly snapshot: ParcelSnapshot;
  readonly costs: readonly ItemCostInput[];
}): { readonly lines: ProfitLine[]; readonly issues: ProfitIssue[] } {
  const { snapshot, costs } = params;
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

    const result = buildItemCostLines({ item, entry, snapshot });
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
