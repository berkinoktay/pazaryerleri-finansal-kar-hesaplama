import type { Element } from '@xmldom/xmldom';

import { MAX_FORMAT_CODE_LENGTH, MAX_TOTAL_CELLS } from './constants';
import { SpreadsheetFileError } from './errors';
import { UNSAFE_CONTENT_DETAILS } from './patch/reasons';
import { colRefToNumber } from './sheet-meta';
import { childElements, corruptPart, localName } from './xml-dom';

// The upload gate's DOM checks on one strictly parsed reader part (PR 1's rules). They
// walk the DOM the way read-excel-file 9.2.0 did (modules/xml/xlsx.js): elements by
// local name among DIRECT children only, so a text (regex) scan cannot be fooled by a
// `>` inside an attribute value, a comment child, a non-ASCII namespace prefix or a
// character-referenced `r`:
//   1. a part whose root has a direct `sheetData` child is a worksheet, whatever its
//      name (a workbook rels Target may name any entry):
//      a. more than one direct `dimension` child is CORRUPT_FILE (real files carry at
//         most one; the grid is sized from the cells, never from a dimension);
//      b. each `row` under the first `sheetData` holds at most
//         ROW_CHILD_NODES_PER_COLUMN x colCap + ROW_CHILD_NODES_SLACK child nodes
//         (text and comments included), and its cells share one row number and go
//         strictly right; otherwise CORRUPT_FILE;
//      c. every cell carries an exact `r` reference (1-3 column letters, a row without
//         a leading zero); the largest row and column are capped as the cells are
//         walked, and so is their product (MAX_TOTAL_CELLS);
//   2. on every part, a `numFmt` under a direct `numFmts` child of the root whose
//      `formatCode` is longer than Excel's limit is UNSAFE_CONTENT.

const SHEET_DATA = 'sheetData';
const DIMENSION = 'dimension';
const ROW = 'row';
const CELL = 'c';
const NUMBER_FORMATS = 'numFmts';
const NUMBER_FORMAT = 'numFmt';
const CELL_REF_ATTRIBUTE = 'r';
const FORMAT_CODE_ATTRIBUTE = 'formatCode';
// The only cell reference shape accepted: column letters, then a row number.
const CELL_REF = /^([A-Z]{1,3})([1-9]\d{0,6})$/;
// Child nodes a row may hold per allowed column (the cell plus text or comments
// around it), plus a fixed slack.
const ROW_CHILD_NODES_PER_COLUMN = 4;
const ROW_CHILD_NODES_SLACK = 16;

export interface GridCaps {
  readonly rowCap: number;
  readonly colCap: number;
}

export interface CellPosition {
  readonly row: number;
  readonly col: number;
}

/** Called for every cell of a checked worksheet, after the cell passed its checks. */
export type CellVisitor = (cell: Element, row: Element, position: CellPosition) => void;

function cellPosition(entry: string, cell: Element): CellPosition {
  const ref = cell.getAttribute(CELL_REF_ATTRIBUTE);
  const match = ref === null ? null : CELL_REF.exec(ref);
  const letters = match?.[1];
  const digits = match?.[2];
  if (letters === undefined || digits === undefined) {
    throw corruptPart(entry, 'Cell reference is missing or malformed');
  }
  return { row: Number(digits), col: colRefToNumber(letters) };
}

function assertCellWithinCaps(entry: string, position: CellPosition, caps: GridCaps): void {
  if (position.row > caps.rowCap + 1) {
    throw new SpreadsheetFileError(
      'ROW_CAP_EXCEEDED',
      `Sheet '${entry}' has a cell in row ${position.row}, beyond the row cap`,
      { entry, row: position.row, rowCap: caps.rowCap },
    );
  }
  if (position.col > caps.colCap) {
    throw new SpreadsheetFileError(
      'COL_CAP_EXCEEDED',
      `Sheet '${entry}' has a cell in column ${position.col}, beyond cap ${caps.colCap}`,
      { entry, col: position.col, colCap: caps.colCap },
    );
  }
}

function assertSingleDimension(entry: string, rootChildren: readonly Element[]): void {
  let dimensions = 0;
  for (const child of rootChildren) {
    if (localName(child.tagName) !== DIMENSION) continue;
    dimensions += 1;
    if (dimensions > 1) throw corruptPart(entry, 'Worksheet has more than one dimension');
  }
}

/** Checks and caps every cell under `sheetData` as it is walked; `visit` sees each checked cell. */
function checkCells(
  entry: string,
  sheetData: Element,
  caps: GridCaps,
  visit: CellVisitor | undefined,
): void {
  const rowChildNodeLimit = ROW_CHILD_NODES_PER_COLUMN * caps.colCap + ROW_CHILD_NODES_SLACK;
  let maxRow = 0;
  let maxCol = 0;
  for (const row of childElements(sheetData)) {
    if (localName(row.tagName) !== ROW) continue;
    if (row.childNodes.length > rowChildNodeLimit) {
      throw corruptPart(entry, `Row has more than ${rowChildNodeLimit} child nodes`);
    }
    let rowNumber: number | null = null;
    let lastCol = 0;
    for (const cell of childElements(row)) {
      if (localName(cell.tagName) !== CELL) continue;
      const position = cellPosition(entry, cell);
      if (rowNumber !== null && position.row !== rowNumber) {
        throw corruptPart(entry, 'Row holds cells of different rows');
      }
      if (position.col <= lastCol) {
        throw corruptPart(entry, 'Row cells are not in strictly increasing column order');
      }
      rowNumber = position.row;
      lastCol = position.col;
      assertCellWithinCaps(entry, position, caps);
      maxRow = Math.max(maxRow, position.row);
      maxCol = Math.max(maxCol, position.col);
      if (maxRow * maxCol > MAX_TOTAL_CELLS) {
        throw new SpreadsheetFileError(
          'PAYLOAD_TOO_LARGE',
          `Sheet '${entry}' grid (${maxRow} x ${maxCol}) exceeds cap ${MAX_TOTAL_CELLS} cells`,
          { entry, cells: maxRow * maxCol, cap: MAX_TOTAL_CELLS },
        );
      }
      visit?.(cell, row, position);
    }
  }
}

function assertFormatCodesWithinCap(entry: string, rootChildren: readonly Element[]): void {
  for (const numFmts of rootChildren) {
    if (localName(numFmts.tagName) !== NUMBER_FORMATS) continue;
    for (const numFmt of childElements(numFmts)) {
      if (localName(numFmt.tagName) !== NUMBER_FORMAT) continue;
      const code = numFmt.getAttribute(FORMAT_CODE_ATTRIBUTE);
      if (code === null || code.length <= MAX_FORMAT_CODE_LENGTH) continue;
      throw new SpreadsheetFileError(
        'UNSAFE_CONTENT',
        `Workbook part '${entry}' has a number format longer than ${MAX_FORMAT_CODE_LENGTH} characters`,
        { detail: UNSAFE_CONTENT_DETAILS.NUMBER_FORMAT_LENGTH, entry, cap: MAX_FORMAT_CODE_LENGTH },
      );
    }
  }
}

/**
 * Runs the gate's DOM checks (see the header) on the root of the reader part `entry`;
 * `visit` is called for every worksheet cell after its checks. Throws
 * SpreadsheetFileError: CORRUPT_FILE for a second dimension, a malformed cell
 * reference or a malformed row; ROW_CAP_EXCEEDED / COL_CAP_EXCEEDED for a cell beyond
 * the caps; PAYLOAD_TOO_LARGE for a grid beyond MAX_TOTAL_CELLS; UNSAFE_CONTENT for an
 * over-long number format.
 */
export function checkPart(entry: string, root: Element, caps: GridCaps, visit?: CellVisitor): void {
  const rootChildren = childElements(root);
  const sheetData = rootChildren.find((child) => localName(child.tagName) === SHEET_DATA);
  if (sheetData !== undefined) {
    assertSingleDimension(entry, rootChildren);
    checkCells(entry, sheetData, caps, visit);
  }
  assertFormatCodesWithinCap(entry, rootChildren);
}
