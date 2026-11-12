import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

import { readFixture } from './fixture-pins';

// Workbooks the size tests grow from the committed fixtures, shared by the gate tests
// (guards.test.ts) and the worker tests.

const WORKBOOK_RELS_PART = 'xl/_rels/workbook.xml.rels';
const WORKBOOK_PART = 'xl/workbook.xml';
const SHEET_PART = 'xl/worksheets/sheet1.xml';
const SHARED_STRINGS_PART = 'xl/sharedStrings.xml';
const STYLES_PART = 'xl/styles.xml';
const SHEET_DATA_OPEN = '<sheetData>';
const SHEET_DATA_CLOSE = '</sheetData>';
// The start tag of a row or a cell, and the row number of the `r` reference inside it.
const ROW_OR_CELL_START_TAG = /<(?:row|c)\b[^>]*>/g;
const REFERENCE_ROW_NUMBER = /(\sr="[A-Z]*)\d+"/;

/** `rows` rows of `columns` numbers each, header row included. */
export function numberRows(rows: number, columns: number): number[][] {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: columns }, (_, c) => r * columns + c),
  );
}

/** Text of the named entries of `file`, joined. */
export function entriesText(file: Buffer, names: readonly string[]): string {
  const entries = unzipSync(new Uint8Array(file));
  return names
    .map((name) => {
      const bytes = entries[name];
      if (bytes === undefined) throw new Error(`entry missing: ${name}`);
      return strFromU8(bytes);
    })
    .join('');
}

/** A worksheet whose `<row>` elements are repeated until it holds `rows` of them. */
interface GrownSheet {
  /** The worksheet text before the first row. */
  readonly head: string;
  /** The fixture's rows, repeated in order, verbatim. */
  readonly rows: readonly string[];
  /** The worksheet text after the last row. */
  readonly tail: string;
}

function growSheet(sheet: string, rows: number): GrownSheet {
  const start = sheet.indexOf(SHEET_DATA_OPEN) + SHEET_DATA_OPEN.length;
  const end = sheet.indexOf(SHEET_DATA_CLOSE);
  const fixtureRows = sheet.slice(start, end).match(/<row\b[\s\S]*?<\/row>\s*/g) ?? [];
  const grown = Array.from({ length: rows }, (_, i) => fixtureRows[i % fixtureRows.length] ?? '');
  return { head: sheet.slice(0, start), rows: grown, tail: sheet.slice(end) };
}

/** `row` with the row number of its own and of every cell's `r` reference set to `rowNumber`. */
function renumberRow(row: string, rowNumber: number): string {
  return row.replace(ROW_OR_CELL_START_TAG, (tag) =>
    tag.replace(REFERENCE_ROW_NUMBER, `$1${rowNumber}"`),
  );
}

/**
 * The reader parts of a real export, its sheet's rows repeated until it holds `rows`
 * rows (the rels, workbook, styles and shared strings parts unchanged), joined.
 */
export function grownFixtureText(file: string, rows: number): string {
  const upload = readFixture(file);
  const sheet = growSheet(entriesText(upload, [SHEET_PART]), rows);
  const others = entriesText(upload, [
    WORKBOOK_RELS_PART,
    WORKBOOK_PART,
    STYLES_PART,
    SHARED_STRINGS_PART,
  ]);
  return sheet.head + sheet.rows.join('') + sheet.tail + others;
}

/**
 * A real export whose sheet's rows are repeated until it holds `rows` rows, re-zipped
 * with every other entry unchanged. Each repeated row and its cells are renumbered to
 * its new position, so the grid it reads to has `rows` rows.
 */
export function grownFixtureWorkbook(file: string, rows: number): Buffer {
  const entries = unzipSync(new Uint8Array(readFixture(file)));
  const sheetBytes = entries[SHEET_PART];
  if (sheetBytes === undefined) throw new Error(`entry missing: ${SHEET_PART}`);
  const sheet = growSheet(strFromU8(sheetBytes), rows);
  const renumbered = sheet.rows.map((row, i) => renumberRow(row, i + 1));
  entries[SHEET_PART] = strToU8(sheet.head + renumbered.join('') + sheet.tail);
  return Buffer.from(zipSync(entries));
}
