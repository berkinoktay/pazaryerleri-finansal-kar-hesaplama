import { describe, expect, it } from 'vitest';

import { fileErrorOf } from '../../tests/helpers/errors';
import type { SheetData } from '../grid-types';
import { assertAnchorsMatch } from './anchors';
import type { PatchAnchor } from './patch-request';

const GRID: SheetData = [['Barcode'], ['B1'], [8690000000001], [' B3 ']];
const FAILING_ROWS = 12;

function anchor(excelRow: number, expected: string, col = 0): PatchAnchor {
  return { excelRow, col, expected };
}

function expectMismatch(
  grid: SheetData,
  anchors: readonly PatchAnchor[],
  meta: Record<string, unknown>,
): void {
  const error = fileErrorOf(() => assertAnchorsMatch(grid, anchors));
  expect(error.code).toBe('ROW_ANCHOR_MISMATCH');
  expect(error.meta).toEqual(meta);
}

describe('assertAnchorsMatch', () => {
  it('passes anchors whose cells read as expected through cellText', () => {
    expect(() =>
      assertAnchorsMatch(GRID, [anchor(2, 'B1'), anchor(3, '8690000000001'), anchor(4, 'B3')]),
    ).not.toThrow();
  });

  it('passes an empty anchor list', () => {
    expect(() => assertAnchorsMatch(GRID, [])).not.toThrow();
    expect(() => assertAnchorsMatch([], [])).not.toThrow();
  });

  it('counts the failing anchors and lists their rows', () => {
    expectMismatch(GRID, [anchor(2, 'B1'), anchor(3, 'X'), anchor(4, 'X')], {
      count: 2,
      rows: [3, 4],
    });
  });

  it('fails an anchor beyond the grid', () => {
    expectMismatch(GRID, [anchor(9, 'B1')], { count: 1, rows: [9] });
  });

  it('fails an anchor on a column beyond the row', () => {
    expectMismatch(GRID, [anchor(2, 'B1', 3)], { count: 1, rows: [2] });
  });

  it('counts two failing anchors on one row twice and lists the row once', () => {
    expectMismatch(GRID, [anchor(3, 'X'), anchor(3, 'Y', 1)], { count: 2, rows: [3] });
  });

  it('lists the first rows ascending whatever order the anchors come in', () => {
    // Rows 12 down to 1.
    const anchors = Array.from({ length: FAILING_ROWS }, (_, position) =>
      anchor(FAILING_ROWS - position, 'X'),
    );
    expectMismatch(GRID, anchors, {
      count: FAILING_ROWS,
      rows: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    });
  });

  it('carries no cell text in the error', () => {
    const error = fileErrorOf(() => assertAnchorsMatch(GRID, [anchor(2, 'secret')]));
    expect(error.message).not.toContain('secret');
    expect(error.message).not.toContain('B1');
  });
});
