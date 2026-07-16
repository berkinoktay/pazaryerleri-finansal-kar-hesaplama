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
// COVERING-ONLY rule (Berkin 2026-07-16): the band tier is authoritative ONLY when a tariff
// week COVERS the anchor instant. An expired week's tariff no longer exists for the seller on
// Trendyol's side, so its bands are never a valid rate. Both paths obey this uniformly:
//
// 1. Try a covering-week lookup across ALL the store's commission tariffs at the anchor
//    instant — the tariff whose week bounds cover the anchor, and within it the sub-period
//    covering the anchor (else the week's first period). If a covering period exists → use it.
// 2. ELSE there are NO authoritative bands — the resolution is null. This holds for the anlık
//    `now` anchor (the current week's tariff is not uploaded yet) AND for a future campaign
//    start whose week is not uploaded (the current week's rates are not authoritative for a
//    future date either). The per-item chain then falls through to the product's synced rate,
//    then the category rate, then NO_COMMISSION.
//
// Running the covering lookup on the `now` anchor too (not just future starts) also kills the
// upload-order trap: with two adjacent weeks uploaded OUT of order, the week that actually
// COVERS today wins over whichever tariff happens to carry the newest createdAt.
//
// The orchestrator also reports whether the store's uploaded tariffs are OUTDATED: it has ≥1
// commission tariff but none covers the anchor. That signal drives the detail's note telling
// the seller their uploads don't reach this campaign's week; it is false when a covering week
// resolved OR the store has no tariffs at all. The flag is computed here ONCE so both
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

import { type CommissionSourceResolution } from './advantage-tariff.service';
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
 * The commission source the discount vertical resolved (null when no tariff week covers the
 * anchor), plus whether the store's uploaded tariffs are OUTDATED: it has ≥1 commission tariff
 * but none covers the anchor. `outdated` is false when a covering week resolved OR the store has
 * no tariffs at all. The detail surfaces the flag; the estimate ignores it. Computing it in the
 * orchestrator keeps both consuming services dumb.
 */
export interface ResolvedDiscountCommission {
  readonly resolution: CommissionSourceResolution | null;
  readonly outdated: boolean;
}

/**
 * Resolves the discount list's commission source under the covering-only anchor rule (see the
 * module header): a tariff week must COVER the anchor instant (a future `startsAt`, else `now`)
 * for its bands to be authoritative. No covering week → a null resolution (NO bands at all) —
 * the per-item chain then falls through to the product's synced rate, the category rate, then
 * NO_COMMISSION. Also returns an `outdated` flag: true only when the store has ≥1 commission
 * tariff yet none covers the anchor. Applied identically by the detail and estimate services.
 */
export async function resolveDiscountCommissionSource(
  orgId: string,
  storeId: string,
  listStartsAt: Date | null,
  now: Date,
): Promise<ResolvedDiscountCommission> {
  const anchor =
    listStartsAt !== null && listStartsAt.getTime() > now.getTime() ? listStartsAt : now;

  // The tariff week that COVERS the anchor instant, across ALL the store's tariffs. Running this
  // on the `now` anchor too means the week that covers today beats whichever tariff carries the
  // newest createdAt — the upload-order trap. An expired week never covers an anchor ≥ now.
  const covering = await resolveCommissionSourceCovering(orgId, storeId, anchor);
  if (covering !== null) {
    return { resolution: covering, outdated: false };
  }

  // No covering week → no authoritative bands. Distinguish "seller's uploads are stale / don't
  // reach the campaign start" (has ≥1 tariff → outdated) from "no tariffs at all" (nothing to be
  // outdated), so the detail only warns when there is actually a stale upload to point at.
  let tariffCount;
  try {
    tariffCount = await prisma.commissionTariff.count({
      where: { organizationId: orgId, storeId },
    });
  } catch (err) {
    mapPrismaError(err);
  }
  return { resolution: null, outdated: tariffCount > 0 };
}
