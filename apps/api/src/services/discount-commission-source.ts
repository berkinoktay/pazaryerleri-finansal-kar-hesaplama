// Commission-source resolution for the İndirimler (discount list) vertical, with a
// FUTURE-start anchor. Shared by BOTH discount services (detail + estimate) so the row,
// the summary and the breakdown modal always agree on which tariff period fed the bands.
//
// Domain fact (Berkin 2026-07-14): Trendyol's product-API commission is tariff-agnostic,
// so the tariff band tier is the ONLY true rate for a tariff product. This anchors that
// band tier to WHEN the campaign actually starts:
//
//   anchor = (list.startsAt !== null && list.startsAt > now) ? list.startsAt : now
//
// - anchor === now  → EXISTING behavior, byte-for-byte: the store's LATEST-created tariff,
//   resolved at `now` via the Advantage resolver (active-now ?? soonest-upcoming ?? last).
// - anchor is future → FIRST try a covering-week lookup across ALL the store's commission
//   tariffs (not just the latest): the tariff whose week bounds cover the anchor, and
//   within it the sub-period covering the anchor (else the week's first period). If a
//   covering period exists → use it. If NO covering week → fall back to the existing path.
//
// CRITICAL timezone frame: commission tariff week/period bounds are persisted as İstanbul
// WALL-CLOCK-as-UTC (via the commission import's `parsePeriodPart`), while `list.startsAt`
// is a TRUE instant. We mirror the Flash resolver's normalization EXACTLY — each stored
// bound is reconciled to a true instant with `businessZoneEpochToInstant(bound.getTime())`
// before comparing — so `weekStart <= anchor < weekEnd` (and the sub-period test) is
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
 * Resolves the discount list's commission source under the future-start anchor rule (see
 * the module header). A future `startsAt` first attempts the covering-week lookup; anything
 * else — anchor at `now`, or a future anchor with no covering week — resolves the store's
 * LATEST-created tariff at `now` (the pre-anchor behavior). Returns null when the store has
 * no usable commission tariff. Applied identically by the detail and estimate services.
 */
export async function resolveDiscountCommissionSource(
  orgId: string,
  storeId: string,
  listStartsAt: Date | null,
  now: Date,
): Promise<CommissionSourceResolution | null> {
  if (listStartsAt !== null && listStartsAt.getTime() > now.getTime()) {
    const covering = await resolveCommissionSourceCovering(orgId, storeId, listStartsAt);
    if (covering !== null) return covering;
  }

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
  if (latestTariff === null) return null;
  return resolveCommissionSource(orgId, storeId, latestTariff.id, now);
}
