import type { SyncType } from '@pazarsync/db/enums';

const MS_PER_HOUR = 60 * 60 * 1000;

/** A page-sync source row narrowed to the two fields staleness reads. */
interface SourceFreshness {
  syncType: SyncType;
  lastSyncedAt: string | null;
}

/**
 * The newest last-success timestamp among the page's PRIMARY sources, or `null`
 * when none of them has ever succeeded. The stale banner keys on THIS rather
 * than the control's all-sources timestamp: a page is "stale" about its own
 * subject (Returns → CLAIMS), not a secondary flow (Returns' ORDERS) that stays
 * fresh on its own schedule and would otherwise mask a 30-hour-old primary. When
 * a page has several primaries (Products → PRODUCTS + PRODUCTS_DELTA) the
 * freshest one wins — an hourly delta keeps the page fresh even after the nightly
 * full scan ages out.
 */
export function newestPrimarySyncedAt(
  sources: readonly SourceFreshness[],
  primaryTypes: readonly SyncType[],
): string | null {
  const primary = new Set(primaryTypes);
  const times = sources
    .filter((source) => primary.has(source.syncType))
    .map((source) => source.lastSyncedAt)
    .filter((time): time is string => time !== null);
  if (times.length === 0) return null;
  return times.reduce((acc, time) => (Date.parse(time) > Date.parse(acc) ? time : acc));
}

/**
 * The whole-hours age of the last successful sync when it is older than the
 * page's stale window, or `null` when it is still fresh. Mirrors the chip's
 * 'stale' derivation in derive-page-sync (`age > staleAfterHours`, strictly
 * greater) so the banner and the freshness chip agree on the same threshold.
 * The returned number is the floored hours since the last success — the figure
 * shown in the "Bu veriler {hours} saattir güncellenmedi" banner copy.
 *
 * Pure and latched-clock based (no live tick): the caller passes a stable `now`
 * (usePageSyncSnapshot's latched clock), so the banner does not re-render every
 * second.
 */
export function deriveStaleHours(
  lastSyncedAt: string,
  now: Date,
  staleAfterHours: number,
): number | null {
  const ageMs = now.getTime() - Date.parse(lastSyncedAt);
  if (!(ageMs > staleAfterHours * MS_PER_HOUR)) return null;
  return Math.floor(ageMs / MS_PER_HOUR);
}
