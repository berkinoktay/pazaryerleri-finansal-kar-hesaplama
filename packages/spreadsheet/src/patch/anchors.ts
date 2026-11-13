import { cellText } from '../cells';
import { PATCH_ERROR_ROW_SAMPLE } from '../constants';
import { SpreadsheetFileError } from '../errors';
import type { CellValue, SheetData } from '../grid-types';
import type { PatchAnchor } from './patch-request';
import { valueAt } from './xml-lexer';

// The anchor check of the export patch path: before any byte is written, every
// anchor cell of the reader's grid must read, through `cellText`, exactly as the
// caller expects. A mismatch means the stored file is not the one the caller built
// its patches from; one error reports every failing anchor.

const NO_ROW: readonly CellValue[] = [];

/**
 * Rejected cells of one error: how many, and the PATCH_ERROR_ROW_SAMPLE smallest
 * distinct rows among them, ascending, whatever order the rows arrive in. Each add
 * costs at most PATCH_ERROR_ROW_SAMPLE steps, and nothing grows with the count.
 */
export class RejectedRows {
  count = 0;
  readonly rows: number[] = [];

  add(row: number): void {
    this.count += 1;
    const rows = this.rows;
    let at = rows.length;
    while (at > 0 && valueAt(rows, at - 1) > row) at -= 1;
    if (at >= PATCH_ERROR_ROW_SAMPLE || rows[at - 1] === row) return;
    rows.splice(at, 0, row);
    if (rows.length > PATCH_ERROR_ROW_SAMPLE) rows.pop();
  }
}

/**
 * Throws SpreadsheetFileError ROW_ANCHOR_MISMATCH `{ count, rows }` unless every anchor
 * cell of `grid` reads as its `expected` through `cellText` (a row beyond the grid
 * reads as empty, so its anchor fails). `count` is the number of failing anchors;
 * `rows` the first PATCH_ERROR_ROW_SAMPLE distinct rows among them, ascending. The
 * anchors may come in any order.
 */
export function assertAnchorsMatch(grid: SheetData, anchors: readonly PatchAnchor[]): void {
  const failing = new RejectedRows();
  for (const anchor of anchors) {
    const row = grid[anchor.excelRow - 1] ?? NO_ROW;
    if (cellText(row, anchor.col) !== anchor.expected) failing.add(anchor.excelRow);
  }
  if (failing.count === 0) return;
  throw new SpreadsheetFileError(
    'ROW_ANCHOR_MISMATCH',
    `${failing.count} anchor cells do not read as expected`,
    { count: failing.count, rows: failing.rows },
  );
}
