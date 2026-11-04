// The single answer to "which tariff period covers this moment?". Commission
// tariff period (and week) bounds are stored as an Istanbul wall-clock value saved
// verbatim as UTC (the commission import parses labels with `Date.UTC`), while the
// moment they are matched against -- an order instant, "now", a campaign start -- is
// a true instant. These helpers reconcile the two frames in ONE place (no second
// offset calculation, no raw comparison) and compare on a half-open [start, end)
// interval so two adjacent periods that touch at a boundary never both cover it.

import { businessZoneEpochToInstant } from './timezone';

/**
 * Converts a stored tariff bound (Istanbul wall-clock saved as UTC) to the real
 * instant it denotes. Reuses the one business-timezone conversion in the package.
 */
export function tariffBoundToInstant(bound: Date): Date {
  return businessZoneEpochToInstant(bound.getTime());
}

/**
 * True when `at` falls inside the period on a half-open [start, end) interval, both
 * bounds first converted to their real instants. The end bound is exclusive so a
 * moment on the boundary belongs to the period that STARTS there, not the one that
 * ends there.
 */
export function isInstantWithinTariffPeriod(
  period: { readonly startsAt: Date; readonly endsAt: Date },
  at: Date,
): boolean {
  const startMs = tariffBoundToInstant(period.startsAt).getTime();
  const endMs = tariffBoundToInstant(period.endsAt).getTime();
  const atMs = at.getTime();
  return startMs <= atMs && atMs < endMs;
}

/**
 * The first period (in input order) that covers `at`, or null when none does.
 * Ordering and tie-breaks are the caller's responsibility: this returns the first
 * covering period it meets, so the caller sorts the list the way it wants ties
 * resolved before calling.
 */
export function findCoveringTariffPeriod<
  T extends { readonly startsAt: Date; readonly endsAt: Date },
>(periods: readonly T[], at: Date): T | null {
  for (const period of periods) {
    if (isInstantWithinTariffPeriod(period, at)) return period;
  }
  return null;
}
