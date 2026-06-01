import { describe, expect, it } from 'vitest';

import { getPaginationRange } from '@/lib/pagination-range';

describe('getPaginationRange', () => {
  it('shows every page when the count fits the window (no ellipsis)', () => {
    expect(getPaginationRange(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(getPaginationRange(3, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(getPaginationRange(7, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('collapses the right side near the start', () => {
    expect(getPaginationRange(1, 20)).toEqual([1, 2, 3, 4, 5, 'ellipsis-right', 20]);
    expect(getPaginationRange(3, 20)).toEqual([1, 2, 3, 4, 5, 'ellipsis-right', 20]);
  });

  it('collapses the left side near the end', () => {
    expect(getPaginationRange(20, 20)).toEqual([1, 'ellipsis-left', 16, 17, 18, 19, 20]);
    expect(getPaginationRange(18, 20)).toEqual([1, 'ellipsis-left', 16, 17, 18, 19, 20]);
  });

  it('collapses both sides in the middle', () => {
    expect(getPaginationRange(10, 20)).toEqual([
      1,
      'ellipsis-left',
      9,
      10,
      11,
      'ellipsis-right',
      20,
    ]);
  });

  it('always includes the first and last page plus the current page', () => {
    for (let current = 1; current <= 50; current += 1) {
      const items = getPaginationRange(current, 50);
      expect(items[0]).toBe(1);
      expect(items[items.length - 1]).toBe(50);
      expect(items).toContain(current);
    }
  });

  it('respects a wider sibling window', () => {
    expect(getPaginationRange(10, 20, 2)).toEqual([
      1,
      'ellipsis-left',
      8,
      9,
      10,
      11,
      12,
      'ellipsis-right',
      20,
    ]);
  });

  it('clamps out-of-range / degenerate inputs', () => {
    expect(getPaginationRange(0, 5)).toEqual([1, 2, 3, 4, 5]); // current < 1 → 1
    expect(getPaginationRange(99, 5)).toEqual([1, 2, 3, 4, 5]); // current > count → last
    expect(getPaginationRange(1, 0)).toEqual([1]); // count < 1 → 1
    expect(getPaginationRange(1, 1)).toEqual([1]);
  });

  it('never emits an ellipsis in place of a single hidden page boundary', () => {
    // 6 pages, current 3 fits (maxSlots 7) → all shown, no stray ellipsis.
    expect(getPaginationRange(3, 6)).toEqual([1, 2, 3, 4, 5, 6]);
    // Boundary currents where a naive guard would "…" a SINGLE hidden page:
    // page 2 (left) and page total-1 (right) must render as NUMBERS, not "…".
    expect(getPaginationRange(4, 20)).toEqual([1, 2, 3, 4, 5, 'ellipsis-right', 20]);
    expect(getPaginationRange(17, 20)).toEqual([1, 'ellipsis-left', 16, 17, 18, 19, 20]);
    // 8 pages / page 4 — the DataTable default-page-size case (80 rows ÷ 10).
    expect(getPaginationRange(4, 8)).toEqual([1, 2, 3, 4, 5, 'ellipsis-right', 8]);
  });
});
