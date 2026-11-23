import { getBusinessDayRange } from '@pazarsync/utils';

/**
 * The one cost rule (plan PR-3b): which seller cost links count for an order and
 * which version prices them. Owner rule (Berkin 2026-11-23): an archived or detached
 * cost profile is ignored by every later order; what counts is the state in force
 * when the order's profit is decided.
 *
 * Two instants:
 *   - `at`, the decision time: the end of the order's Istanbul business day
 *     (`costDecisionTime`). While the day is open no link or version can be stamped
 *     after it, so for today's order this is the current state; for a past day it is
 *     that day's end. The app clock is never compared with database stamps.
 *   - `orderDate`, the order instant: the price is the version in force at the order
 *     time (Berkin 2026-11-23: the amount at the order time), unless none was in
 *     force then or it was an archive version; then the version in force at `at`.
 *
 * Every boundary is inclusive: a link attached, or a version effective, exactly at
 * `at` counts.
 */

/** The fields of a cost profile version the rule reads. `CostProfileVersionInput` satisfies it. */
export interface CostVersionState {
  readonly effectiveFrom: Date;
  readonly versionNumber: number; // breaks an effective-date tie: the higher number is the newer version
  readonly archivedAt: Date | null; // non-null = the profile is archived from this version on
}

/** A cost profile link to a variant, with its profile's full version history. */
export interface LinkedCostProfile<V extends CostVersionState> {
  readonly attachedAt: Date;
  readonly versions: readonly V[];
}

/** The order's Istanbul business-day end (getBusinessDayRange(orderDate).end). Never the app clock. */
export function costDecisionTime(orderDate: Date): Date {
  return getBusinessDayRange(orderDate).end;
}

/** True when `a` sorts before `b` by (effectiveFrom, versionNumber) ascending. */
function versionPrecedes(a: CostVersionState, b: CostVersionState): boolean {
  const aTime = a.effectiveFrom.getTime();
  const bTime = b.effectiveFrom.getTime();
  if (aTime !== bTime) return aTime < bTime;
  return a.versionNumber < b.versionNumber;
}

/**
 * The version in force at `instant`: the greatest (effectiveFrom, versionNumber)
 * among the versions effective on or before it; null when none is.
 */
function versionAt<V extends CostVersionState>(versions: readonly V[], instant: Date): V | null {
  const time = instant.getTime();
  let latest: V | null = null;
  for (const version of versions) {
    if (version.effectiveFrom.getTime() > time) continue;
    if (latest === null || versionPrecedes(latest, version)) {
      latest = version;
    }
  }
  return latest;
}

/**
 * True when the link counts at `at`: it was attached on or before `at`, its profile
 * has a version in force at `at`, and that version is not an archive version. A
 * profile with no version row never counts.
 */
export function isCostLinkInForce(link: LinkedCostProfile<CostVersionState>, at: Date): boolean {
  if (link.attachedAt.getTime() > at.getTime()) return false;
  const current = versionAt(link.versions, at);
  return current !== null && current.archivedAt === null;
}

/** null when not in force; else the order-time version when it existed and was not archived, otherwise the version in force at `at`. */
export function chooseOrderCostVersion<V extends CostVersionState>(
  link: LinkedCostProfile<V>,
  params: { readonly orderDate: Date; readonly at: Date },
): V | null {
  if (!isCostLinkInForce(link, params.at)) return null;
  const atOrderTime = versionAt(link.versions, params.orderDate);
  if (atOrderTime !== null && atOrderTime.archivedAt === null) return atOrderTime;
  return versionAt(link.versions, params.at);
}
