// Pure window math for the hourly PRODUCTS_CHANGES sync. No I/O and no wall
// clock: the run's startedAt and the anchors (startedAt of the store's last
// COMPLETED runs, read by `syncLogService.getLastCompletedRunStartedAt`) come
// in as ms-epoch numbers, so the module is unit-tested in isolation. The
// handler computes the window once, in the run's first chunk, stores it in the
// cursor, and derives each phase's Trendyol query range from that cursor.

import type { ProductsChangesCursor, ProductsChangesPhase } from '@pazarsync/sync-core';

// --- Constants ---------------------------------------------------------------

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Subtracted from the anchor so consecutive windows overlap. Absorbs a change
 * stamped just before the previous run started but not yet visible to its
 * query. The overlap only re-writes rows, and the catalog upsert is idempotent.
 */
export const PRODUCTS_CHANGES_SAFETY_MARGIN_MS = 15 * MS_PER_MINUTE;

/**
 * The window never reaches further back than this. After a longer outage the
 * nightly full scan has already covered the gap, so a bigger window would only
 * re-read rows it refreshed.
 */
export const PRODUCTS_CHANGES_MAX_LOOKBACK_MS = 48 * MS_PER_HOUR;

/**
 * Added to windowEnd in every phase's query. Trendyol may stamp Istanbul
 * wall-clock time as if it were UTC: it does on orders; on products it is
 * unproven (the stage probe saw no recent changes to compare). Trendyol
 * accepts an endDate in the future (stage probe: 200), so the allowance costs
 * nothing when the stamps are true UTC, and the overlap with the next window
 * only re-writes idempotent rows.
 */
export const PRODUCTS_CHANGES_END_ALLOWANCE_MS = 3 * MS_PER_HOUR;

/**
 * Look-back of the VARIANT_CREATED_DATE phase, counted back from windowEnd.
 * The approved list only shows a product after Trendyol approves it, and an
 * approval may not advance the modified dates. Querying products created in
 * the last week catches one approved late, whatever the window size.
 *
 * Cost, accepted: every product created in the last week is re-read and
 * re-upserted on every hourly run (about 168 times in its first week), one
 * request per 100 such products. That stays far below Trendyol's read limit
 * on the serial worker, but it is the main hourly load for a seller who
 * bulk-creates products. A run that stops over the cap in an earlier phase
 * skips this phase; the nightly full scan then picks those products up.
 */
export const PRODUCTS_CHANGES_CREATED_LOOKBACK_MS = 7 * MS_PER_DAY;

// --- Window ------------------------------------------------------------------

/** The change window of one PRODUCTS_CHANGES run, ms epoch, start < end. */
export interface ProductsChangesWindow {
  windowStart: number;
  windowEnd: number;
}

/**
 * Change window for one PRODUCTS_CHANGES run, or null when there is none (the
 * run finishes empty).
 *
 *   windowEnd   = this run's startedAt.
 *   anchor      = startedAt of the last COMPLETED PRODUCTS_CHANGES run, else of
 *                 the last COMPLETED PRODUCTS full scan, else null. A fallback,
 *                 never a max: a COMPLETED full scan may have skipped pages or
 *                 stopped at the 10k cap, so it must not move a changes anchor
 *                 forward. Only COMPLETED runs anchor, so a failed run never
 *                 moves the window and the next run rescans the same range.
 *   windowStart = max(anchor - safety margin, windowEnd - max look-back).
 *
 * Null when there is no anchor, or when windowStart >= windowEnd (an anchor at
 * least one safety margin after this run's start, e.g. a retried first run
 * whose fallback full scan started later).
 */
export function computeProductsChangesWindow(args: {
  runStartedAtMs: number;
  lastChangesRunStartedAtMs: number | null;
  lastFullScanStartedAtMs: number | null;
}): ProductsChangesWindow | null {
  const anchorMs = args.lastChangesRunStartedAtMs ?? args.lastFullScanStartedAtMs;
  if (anchorMs === null) return null;

  const windowEnd = args.runStartedAtMs;
  const windowStart = Math.max(
    anchorMs - PRODUCTS_CHANGES_SAFETY_MARGIN_MS,
    windowEnd - PRODUCTS_CHANGES_MAX_LOOKBACK_MS,
  );
  if (windowStart >= windowEnd) return null;

  return { windowStart, windowEnd };
}

// --- Per-phase query range ---------------------------------------------------

/** Trendyol `startDate` / `endDate` of one phase's query, ms epoch. */
export interface ProductsChangesQueryRange {
  startDate: number;
  endDate: number;
}

/**
 * Where each phase's query starts. The modified-date phases read exactly the
 * change window; the created-date phase reads a fixed look-back from the
 * window end (see PRODUCTS_CHANGES_CREATED_LOOKBACK_MS).
 */
const PHASE_QUERY_START: Record<ProductsChangesPhase, (window: ProductsChangesWindow) => number> = {
  VARIANT_MODIFIED_DATE: (window) => window.windowStart,
  CONTENT_MODIFIED_DATE: (window) => window.windowStart,
  VARIANT_CREATED_DATE: (window) => window.windowEnd - PRODUCTS_CHANGES_CREATED_LOOKBACK_MS,
};

/**
 * Trendyol query range for the cursor's phase. Every phase ends at
 * windowEnd + PRODUCTS_CHANGES_END_ALLOWANCE_MS.
 */
export function computeProductsChangesQueryRange(
  cursor: Pick<ProductsChangesCursor, 'phase' | 'windowStart' | 'windowEnd'>,
): ProductsChangesQueryRange {
  return {
    startDate: PHASE_QUERY_START[cursor.phase](cursor),
    endDate: cursor.windowEnd + PRODUCTS_CHANGES_END_ALLOWANCE_MS,
  };
}
