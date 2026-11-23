import { getBusinessDayRange } from '@pazarsync/utils';

import { latestVersionAt } from './cost-version-order';

/**
 * The one cost rule (plan PR-3b, same-day edit window D2): which seller cost links
 * count for an order and which version prices them. Owner rule (Berkin 2026-11-23):
 * an order's cost is the one in force at the end of its Istanbul business day; a
 * change during the day reaches all of that day's orders.
 *
 * One instant, `at`, the decision time: the end of the order's Istanbul business day
 * (`costDecisionTime`). A link counts when it is in force at `at`, and it is priced
 * by its version in force at `at`; the order instant plays no part. While the day is
 * open no link or version can be stamped after it, so for today's order this is the
 * current state; for a past day it is that day's end. The app clock is never
 * compared with database stamps.
 *
 * The version in force at an instant is the one with the highest version number
 * among those effective by then (`latestVersionAt`, amendment A11): the number, not
 * `effectiveFrom`, orders versions, since overlapping writes can commit out of
 * `effectiveFrom` order.
 *
 * Every boundary is inclusive: a link attached, or a version effective, exactly at
 * `at` counts.
 */

/** The fields of a cost profile version the rule reads. `CostProfileVersionInput` satisfies it. */
export interface CostVersionState {
  readonly effectiveFrom: Date;
  readonly versionNumber: number; // orders versions: the higher number is the newer version
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

/**
 * True when the link counts at `at`: it was attached on or before `at`, its profile
 * has a version in force at `at`, and that version is not an archive version. A
 * profile with no version row never counts.
 */
export function isCostLinkInForce(link: LinkedCostProfile<CostVersionState>, at: Date): boolean {
  if (link.attachedAt.getTime() > at.getTime()) return false;
  const current = latestVersionAt(link.versions, at);
  return current !== null && current.archivedAt === null;
}

/** null when the link is not in force at `at`; else its version in force at `at`. */
export function chooseOrderCostVersion<V extends CostVersionState>(
  link: LinkedCostProfile<V>,
  params: { readonly at: Date },
): V | null {
  return isCostLinkInForce(link, params.at) ? latestVersionAt(link.versions, params.at) : null;
}
