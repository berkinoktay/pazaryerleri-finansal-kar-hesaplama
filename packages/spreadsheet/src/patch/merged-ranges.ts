import { ABSOLUTE_MAX_COLS, ABSOLUTE_MAX_ROWS } from '../constants';
import { SpreadsheetFileError } from '../errors';
import type { GridCaps } from '../part-checks';
import { colRefToNumber } from '../sheet-meta';
import type { CellPatch } from './patch-request';
import { MALFORMED_SHEET_REASONS } from './reasons';
import { RejectedRows } from './rejected-rows';
import { valueAt } from './xml-lexer';

// The merged-range check of the export patch path: a value written into a merged cell
// other than its range's top-left corner is hidden by the merge, so such a target is
// refused. Every range is clipped to the area a target can lie in (rows 1..rowCap + 1,
// columns 1..colCap) and added to one 2D difference array over that area, which is
// prefix-summed once in place; each target is then one lookup. The cost is refs +
// area + targets, never refs x targets.

// A merged range's `ref`: one cell, or two corners joined by ':'.
const MERGE_REF = /^([A-Z]{1,3})([1-9]\d{0,6})(?::([A-Z]{1,3})([1-9]\d{0,6}))?$/;
// A difference array needs one row and one column past the area it covers.
const DIFFERENCE_MARGIN = 1;
const CORNER = 1;
const OUTSIDE_AREA = -1;

/**
 * Coverage of the area, row-major, `width` cells per row. `coverage` holds the
 * differences until it is summed, then how many ranges cover each cell; `corners` is
 * CORNER where a range has its top-left corner.
 */
interface MergeArea {
  readonly lastRow: number;
  readonly lastCol: number;
  readonly width: number;
  readonly height: number;
  readonly coverage: Int32Array;
  readonly corners: Uint8Array;
}

function malformedRef(): SpreadsheetFileError {
  return new SpreadsheetFileError(
    'MALFORMED_SHEET',
    'Worksheet has a malformed merged range reference',
    { reason: MALFORMED_SHEET_REASONS.MERGE_REF },
  );
}

/** The corners of `ref` as [first column letters, first row, last letters, last row], or a throw. */
function refParts(ref: string): readonly [string, string, string, string] {
  const match = MERGE_REF.exec(ref);
  const firstLetters = match?.[1];
  const firstDigits = match?.[2];
  if (firstLetters === undefined || firstDigits === undefined) throw malformedRef();
  return [firstLetters, firstDigits, match?.[3] ?? firstLetters, match?.[4] ?? firstDigits];
}

/**
 * The area of `caps`. Its typed arrays live outside the worker's heap limits, so caps
 * past the absolute ceilings are a caller bug (resolveReadOptions clamps them and
 * isResolvedReadOptions refuses them): a plain Error, before anything is allocated.
 */
function createArea(caps: GridCaps): MergeArea {
  if (caps.rowCap > ABSOLUTE_MAX_ROWS || caps.colCap > ABSOLUTE_MAX_COLS) {
    throw new Error(
      `Merge area caps ${caps.rowCap} rows x ${caps.colCap} columns exceed ` +
        `${ABSOLUTE_MAX_ROWS} x ${ABSOLUTE_MAX_COLS}`,
    );
  }
  const lastRow = caps.rowCap + 1;
  const lastCol = caps.colCap;
  const width = lastCol + DIFFERENCE_MARGIN;
  const height = lastRow + DIFFERENCE_MARGIN;
  return {
    lastRow,
    lastCol,
    width,
    height,
    coverage: new Int32Array(width * height),
    corners: new Uint8Array(width * height),
  };
}

/** Adds `delta` to the difference at 0-based `row`, `col`. */
function addDifference(area: MergeArea, row: number, col: number, delta: number): void {
  const index = row * area.width + col;
  area.coverage[index] = valueAt(area.coverage, index) + delta;
}

/** Orders the corners of `ref`, clips the range to the area and adds it. */
function addRange(area: MergeArea, ref: string): void {
  const [firstLetters, firstDigits, lastLetters, lastDigits] = refParts(ref);
  const firstCol = colRefToNumber(firstLetters);
  const lastCol = colRefToNumber(lastLetters);
  const firstRow = Number(firstDigits);
  const lastRow = Number(lastDigits);
  const top = Math.min(firstRow, lastRow);
  const left = Math.min(firstCol, lastCol);
  // Rows and columns start at 1, so clipping only ever moves the bottom-right corner.
  if (top > area.lastRow || left > area.lastCol) return;
  const bottom = Math.min(Math.max(firstRow, lastRow), area.lastRow);
  const right = Math.min(Math.max(firstCol, lastCol), area.lastCol);
  // 0-based: the range covers rows top - 1 .. bottom - 1, columns left - 1 .. right - 1.
  addDifference(area, top - 1, left - 1, 1);
  addDifference(area, top - 1, right, -1);
  addDifference(area, bottom, left - 1, -1);
  addDifference(area, bottom, right, 1);
  area.corners[(top - 1) * area.width + (left - 1)] = CORNER;
}

/** Turns the differences into coverage counts, in place, in one row-major pass. */
function sumCoverage(area: MergeArea): void {
  const { coverage, width, height } = area;
  for (let row = 0; row < height; row += 1) {
    const start = row * width;
    let running = 0;
    for (let col = 0; col < width; col += 1) {
      const index = start + col;
      running += valueAt(coverage, index);
      coverage[index] = row === 0 ? running : running + valueAt(coverage, index - width);
    }
  }
}

/** The area index of 1-based `row` and `column`, or OUTSIDE_AREA when they are not integers inside it. */
function areaIndex(area: MergeArea, row: number, column: number): number {
  if (!Number.isInteger(row) || !Number.isInteger(column)) return OUTSIDE_AREA;
  if (row < 1 || row > area.lastRow || column < 1 || column > area.lastCol) return OUTSIDE_AREA;
  return (row - 1) * area.width + (column - 1);
}

/** True when a target at `index` is covered by a range and is not the top-left corner of its only range. */
function isHidden(area: MergeArea, index: number): boolean {
  const covered = valueAt(area.coverage, index);
  if (covered === 0) return false;
  return covered !== 1 || valueAt(area.corners, index) !== CORNER;
}

/**
 * Throws SpreadsheetFileError MALFORMED_SHEET unless every patch target of `outputs`
 * lies outside the merged ranges `mergeRefs` or on the top-left corner of the one
 * range that covers it. Reasons: `merge-ref` for a ref that is not one cell or two
 * corners (checked for every ref before anything is allocated); `merged-target`
 * `{ count, rows }`, where `count` is the number of rejected patches over all outputs
 * and `rows` the first PATCH_ERROR_ROW_SAMPLE distinct rows among them, ascending. A
 * target whose row or column is not an integer inside the caps is not looked up: no
 * clipped range holds it. The cell patcher would still write it (it checks only row
 * >= 1 and column < ABSOLUTE_MAX_COLS), so patchUpload refuses a target outside the
 * caps before this check runs (resolvePatchRequest already did on the main thread).
 */
export function assertTargetsOutsideMerges(
  mergeRefs: readonly string[],
  outputs: readonly (readonly CellPatch[])[],
  caps: GridCaps,
): void {
  if (mergeRefs.length === 0) return;
  for (const ref of mergeRefs) refParts(ref);

  const area = createArea(caps);
  for (const ref of mergeRefs) addRange(area, ref);
  sumCoverage(area);

  const rejected = new RejectedRows();
  for (const output of outputs) {
    for (const patch of output) {
      const { excelRow, col } = patch;
      const index = areaIndex(area, excelRow, col + 1);
      if (index !== OUTSIDE_AREA && isHidden(area, index)) rejected.add(excelRow);
    }
  }
  if (rejected.count === 0) return;
  throw new SpreadsheetFileError(
    'MALFORMED_SHEET',
    `${rejected.count} cell patches target a merged cell other than its range's top-left corner`,
    { reason: MALFORMED_SHEET_REASONS.MERGED_TARGET, count: rejected.count, rows: rejected.rows },
  );
}
