/**
 * Whole percent complete for a `{ current, total }` progress pair, or `null`
 * when the total is unknown or non-positive.
 *
 * Shared by the sync-freshness surfaces — the SyncControl status half and the
 * SyncSourcesPopover rows both render the same progress figure, so the two-line
 * calc lives here once instead of being copy-pasted per component. It is a
 * presentation helper: it rounds for display and clamps at 100, never derives a
 * financial value.
 */
export function computeProgressPercent(
  progress: { current: number; total: number | null } | null | undefined,
): number | null {
  if (
    progress === null ||
    progress === undefined ||
    progress.total === null ||
    progress.total <= 0
  ) {
    return null;
  }
  return Math.min(100, Math.round((progress.current / progress.total) * 100));
}
