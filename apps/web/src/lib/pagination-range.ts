/**
 * One slot in a numbered pagination strip: a concrete 1-indexed page number, or
 * an ellipsis marker standing in for a collapsed run of pages. Left vs right is
 * tracked so each ellipsis can carry a stable React key.
 */
export type PaginationRangeItem = number | 'ellipsis-left' | 'ellipsis-right';

function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let page = start; page <= end; page += 1) out.push(page);
  return out;
}

/**
 * Builds the windowed list of page items to render in a numbered pagination
 * control: the first and last page are always shown, plus a sibling window
 * around the current page, with an ellipsis marker wherever a run of pages is
 * collapsed.
 *
 * Examples (siblingCount = 1):
 *   (1, 5)  → [1, 2, 3, 4, 5]                         (fits, no ellipsis)
 *   (1, 20) → [1, 2, 3, 4, 5, 'ellipsis-right', 20]
 *   (10, 20)→ [1, 'ellipsis-left', 9, 10, 11, 'ellipsis-right', 20]
 *   (20, 20)→ [1, 'ellipsis-left', 16, 17, 18, 19, 20]
 *
 * @param currentPage 1-indexed current page (clamped into [1, pageCount]).
 * @param pageCount   total number of pages (treated as ≥ 1).
 * @param siblingCount pages shown on EACH side of the current page (default 1).
 */
export function getPaginationRange(
  currentPage: number,
  pageCount: number,
  siblingCount = 1,
): PaginationRangeItem[] {
  const total = Math.max(pageCount, 1);
  const current = Math.min(Math.max(currentPage, 1), total);

  // first + last + current + siblings on both sides + the two ellipsis slots.
  const maxSlots = siblingCount * 2 + 5;
  if (total <= maxSlots) {
    return range(1, total);
  }

  const leftSibling = Math.max(current - siblingCount, 1);
  const rightSibling = Math.min(current + siblingCount, total);

  // Only collapse with an ellipsis when it hides AT LEAST TWO pages. A single
  // hidden page (page 2 on the left, page total-1 on the right) is shown as its
  // number, not a "…" of the same width — so those boundary positions route to
  // the single-side branch below, where the full flank renders as numbers.
  const showLeftEllipsis = leftSibling > 3;
  const showRightEllipsis = rightSibling < total - 2;

  // How many leading / trailing numbers to show when only one side collapses.
  const flankCount = siblingCount * 2 + 3;

  if (!showLeftEllipsis && showRightEllipsis) {
    return [...range(1, flankCount), 'ellipsis-right', total];
  }
  if (showLeftEllipsis && !showRightEllipsis) {
    return [1, 'ellipsis-left', ...range(total - flankCount + 1, total)];
  }
  return [1, 'ellipsis-left', ...range(leftSibling, rightSibling), 'ellipsis-right', total];
}
