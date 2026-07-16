// Commission-source resolution for the İndirimler (discount list) vertical, anchored to when
// the campaign actually starts. Shared by BOTH discount services (detail + estimate) so the
// row, the summary and the breakdown modal always agree on which tariff period fed the bands.
//
// Domain fact (Berkin 2026-07-14): Trendyol's product-API commission is tariff-agnostic,
// so the tariff band tier is the ONLY true rate for a tariff product. This anchors that
// band tier to WHEN the campaign actually starts:
//
//   anchor = (list.startsAt !== null && list.startsAt > now) ? list.startsAt : now
//
// UNIFIED rule — the covering-week lookup at the anchor instant, else best-available (latest
// upload, its last period). BOTH the future-anchor path AND the anlık `now` path go through it:
//
// 1. FIRST try a covering-week lookup across ALL the store's commission tariffs at the anchor
//    instant — the tariff whose week bounds cover the anchor, and within it the sub-period
//    covering the anchor (else the week's first period). If a covering period exists → use it.
// 2. ELSE fall back to best-available: the store's LATEST-uploaded (created) tariff, resolved
//    at `now` via the Advantage resolver (active-now ?? soonest-upcoming ?? its LAST-past
//    period). The last-past period is deliberate — the seller still sees the closest available
//    bands when the current week's tariff has not been uploaded yet.
//
// Running the covering lookup on the `now` anchor too (not just future starts) kills the
// upload-order trap: with two adjacent weeks uploaded OUT of order, the week that actually
// COVERS today wins over whichever tariff happens to carry the newest createdAt.
//
// The orchestrator also reports whether the resolved period is already EXPIRED (its end is
// before `now`). That is only reachable via the best-available fallback — a covering period,
// by definition, ends after an anchor that is ≥ now — and the detail surfaces it so the seller
// knows the current week's tariff is not uploaded yet. The flag is computed here ONCE so both
// consuming services stay dumb.
//
// CRITICAL timezone frame: commission tariff week/period bounds are persisted as İstanbul
// WALL-CLOCK-as-UTC (via the commission import's `parsePeriodPart`), while `list.startsAt`
// and `now` are TRUE instants. We mirror the Flash resolver's normalization EXACTLY — each
// stored bound is reconciled to a true instant with `businessZoneEpochToInstant(bound.getTime())`
// before comparing — so `weekStart <= anchor < weekEnd` (and the sub-period / expiry test) is
// meaningful. See `flash-product-commission.service.ts` for the sibling implementation.
//
// Every query is store-scoped (organizationId + storeId); this vertical never crosses a
// tenant boundary when reading the commission tariffs.

import { prisma } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';
import { businessZoneEpochToInstant } from '@pazarsync/utils';

import {
  resolveCommissionSource,
  type CommissionSourceResolution,
} from './advantage-tariff.service';
import { parseStoredBands, type StoredBand } from './commission-tariff.types';

/**
 * Normalizes a stored commission bound (İstanbul wall-clock-as-UTC) to the true instant,
 * so it is comparable with the list's true-instant `startsAt`. Mirrors the Flash resolver's
 * `boundToInstantMs` — the ONE reconciliation point between the two time frames.
 */
function boundToInstantMs(bound: Date | null): number | null {
  return bound === null ? null : businessZoneEpochToInstant(bound.getTime()).getTime();
}

interface CoveringPeriod {
  readonly id: string;
  readonly dateRangeLabel: string;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  readonly startMs: number | null;
  readonly endMs: number | null;
}

interface CoveringWeek {
  readonly tariffId: string;
  readonly tariffName: string;
  readonly startMs: number | null;
  readonly endMs: number | null;
  readonly periods: ReadonlyArray<CoveringPeriod>;
}

/**
 * Finds the commission tariff whose week bounds cover `anchor` (`weekStart <= anchor <
 * weekEnd`) and, within it, the sub-period covering the anchor (`period.startsAt <= anchor
 * < period.endsAt`) — falling back to the week's FIRST period when the anchor straddles no
 * sub-period. Returns that period's bands (barcode → bands) in the same
 * `CommissionSourceResolution` shape the Advantage resolver returns, so every downstream
 * consumer (the three-tier chain, the transparency fields) is untouched. Returns null when
 * no week covers the anchor.
 *
 * Batched exactly like Flash: ONE query for the store's tariffs+periods, then ONE query
 * for the covering period's items (we only ever need one period). Store-scoped throughout.
 */
export async function resolveCommissionSourceCovering(
  orgId: string,
  storeId: string,
  anchor: Date,
): Promise<CommissionSourceResolution | null> {
  const anchorMs = anchor.getTime();

  let tariffs;
  try {
    tariffs = await prisma.commissionTariff.findMany({
      where: {
        organizationId: orgId,
        storeId,
        weekStartsAt: { not: null },
        weekEndsAt: { not: null },
      },
      select: {
        id: true,
        name: true,
        weekStartsAt: true,
        weekEndsAt: true,
        periods: {
          orderBy: { sortOrder: 'asc' },
          select: { id: true, dateRangeLabel: true, startsAt: true, endsAt: true },
        },
      },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  const weeks: CoveringWeek[] = tariffs.map((t) => ({
    tariffId: t.id,
    tariffName: t.name,
    startMs: boundToInstantMs(t.weekStartsAt),
    endMs: boundToInstantMs(t.weekEndsAt),
    periods: t.periods.map((p) => ({
      id: p.id,
      dateRangeLabel: p.dateRangeLabel,
      startsAt: p.startsAt,
      endsAt: p.endsAt,
      startMs: boundToInstantMs(p.startsAt),
      endMs: boundToInstantMs(p.endsAt),
    })),
  }));

  const week = weeks.find(
    (w) => w.startMs !== null && w.endMs !== null && w.startMs <= anchorMs && anchorMs < w.endMs,
  );
  if (week === undefined) return null;

  const sub = week.periods.find(
    (p) => p.startMs !== null && p.endMs !== null && p.startMs <= anchorMs && anchorMs < p.endMs,
  );
  const period = sub ?? week.periods[0];
  if (period === undefined) return null;

  let items;
  try {
    items = await prisma.commissionTariffItem.findMany({
      where: { organizationId: orgId, storeId, periodId: period.id },
      select: { barcode: true, bands: true },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  const bandsByBarcode = new Map<string, StoredBand[]>();
  for (const item of items) bandsByBarcode.set(item.barcode, parseStoredBands(item.bands));

  return {
    tariffId: week.tariffId,
    tariffName: week.tariffName,
    periodLabel: period.dateRangeLabel,
    startsAt: period.startsAt,
    endsAt: period.endsAt,
    bandsByBarcode,
  };
}

/**
 * The commission source the discount vertical resolved, plus whether the resolved period is
 * already EXPIRED (its END is before `now`). `expired` is only ever true on the best-available
 * fallback path — a covering period ends after an anchor that is ≥ now — and is false when no
 * source resolved. The detail surfaces the flag; the estimate ignores it. Computing it in the
 * orchestrator keeps both consuming services dumb.
 */
export interface ResolvedDiscountCommission {
  readonly resolution: CommissionSourceResolution | null;
  readonly expired: boolean;
}

/**
 * True when the resolution's period END (a stored İstanbul wall-clock-as-UTC bound, normalized
 * to a true instant) is before `now`. False when there is no resolution or no end bound.
 */
function isPeriodExpired(resolution: CommissionSourceResolution | null, now: Date): boolean {
  if (resolution === null) return false;
  const endMs = boundToInstantMs(resolution.endsAt);
  return endMs !== null && endMs < now.getTime();
}

/**
 * Resolves the discount list's commission source under the unified anchor rule (see the module
 * header): FIRST the covering-week lookup at the anchor instant (a future `startsAt`, else
 * `now`), ELSE the store's LATEST-uploaded tariff resolved at `now` (its last-past period the
 * best-available fallback). Returns the resolution plus an `expired` flag (true only when the
 * fallback landed on a period that already ended). Returns a null resolution when the store has
 * no usable commission tariff. Applied identically by the detail and estimate services.
 */
export async function resolveDiscountCommissionSource(
  orgId: string,
  storeId: string,
  listStartsAt: Date | null,
  now: Date,
): Promise<ResolvedDiscountCommission> {
  const anchor =
    listStartsAt !== null && listStartsAt.getTime() > now.getTime() ? listStartsAt : now;

  // FIRST: the tariff week that COVERS the anchor instant, across ALL the store's tariffs.
  // Doing this on the `now` anchor too means the week that covers today beats whichever tariff
  // carries the newest createdAt — the upload-order trap. A covering period ends after an
  // anchor ≥ now, so it can never be expired.
  const covering = await resolveCommissionSourceCovering(orgId, storeId, anchor);
  if (covering !== null) {
    return { resolution: covering, expired: isPeriodExpired(covering, now) };
  }

  // ELSE best-available: the store's latest-uploaded tariff, resolved at `now`.
  let latestTariff;
  try {
    latestTariff = await prisma.commissionTariff.findFirst({
      where: { organizationId: orgId, storeId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
  } catch (err) {
    mapPrismaError(err);
  }
  if (latestTariff === null) return { resolution: null, expired: false };

  const resolution = await resolveCommissionSource(orgId, storeId, latestTariff.id, now);
  return { resolution, expired: isPeriodExpired(resolution, now) };
}
