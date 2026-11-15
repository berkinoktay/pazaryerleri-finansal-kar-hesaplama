// The pure steps of the generic import: the rows of an uploaded sheet through its
// format, the rows a seller already filled in, the stored name, and chunked inserts.

import { Decimal } from 'decimal.js';

import {
  cellDecimal,
  cellText,
  columnIndex,
  createRowReader,
  evaluate,
  SpreadsheetFileError,
  type CellRow,
  type LayoutSpec,
  type RowReader,
} from '@pazarsync/spreadsheet';
import { businessZoneEpochToInstant } from '@pazarsync/utils';

import {
  IMPORT_INSERT_CHUNK_ROWS,
  MAX_ANCHOR_TEXT_LENGTH,
  UPLOAD_NAME_MAX_LENGTH,
} from '../config/workbook-limits';
import type { ImportedRow } from './adapter';
import type { WriteValueSpec } from './format';
import { cleanDisplayName } from './form';
import type { SelectedFormat } from './select-format';
import { WorkbookFileRejection, WorkbookInvariantError } from './workbook-errors';
import type { ResolvedWriteColumn } from './write-columns';

/** `meta.reason` of the MALFORMED_SHEET a too-long anchor cell raises. */
export const ANCHOR_TOO_LONG_REASON = 'anchor-too-long';

const READER_OPTIONS = { toInstant: businessZoneEpochToInstant };
const XLSX_EXTENSION_RE = /\.xlsx$/i;

/** A data row whose anchor cell has text: a row an anchor-map export may patch. */
export interface AnchoredRow {
  readonly excelRow: number;
  readonly anchor: string;
}

export interface ReadRowsResult<S extends LayoutSpec, TRow> {
  readonly rows: readonly ImportedRow<TRow>[];
  readonly skippedRows: number;
  readonly firstDataRow: RowReader<S> | null;
  /** Every data row whose anchor cell has text, kept or not: what an anchor-map export may patch. */
  readonly anchoredRows: readonly AnchoredRow[];
}

/**
 * The data rows of the selected sheet (every row below the header), through the
 * format: a row that fails the keep rule is skipped; a kept row is mapped with its
 * anchor. `excelRow` is the 1-based sheet row (grid index + 1).
 *
 * Throws SpreadsheetFileError MALFORMED_SHEET for an anchor cell longer than
 * MAX_ANCHOR_TEXT_LENGTH (kept or not: the export may anchor on it),
 * WorkbookInvariantError for a kept row without an anchor (the keep rule must imply
 * it), and WorkbookFileRejection EMPTY_FILE when no row is kept.
 */
export function readRows<S extends LayoutSpec, TRow, TWrite extends string>(
  selected: SelectedFormat<S, TRow, TWrite>,
): ReadRowsResult<S, TRow> {
  const { format, grid, layout } = selected;
  const anchorCol = columnIndex(format.layout, layout, format.anchor);
  const firstDataIndex = layout.headerRowIndex + 1;
  const rows: ImportedRow<TRow>[] = [];
  const anchoredRows: AnchoredRow[] = [];
  let skippedRows = 0;
  let firstDataRow: RowReader<S> | null = null;

  for (let index = firstDataIndex; index < grid.length; index += 1) {
    const row = grid[index] ?? [];
    const excelRow = index + 1;
    const reader = createRowReader(format.layout, layout, row, READER_OPTIONS);
    if (index === firstDataIndex) firstDataRow = reader;

    const anchor = cellText(row, anchorCol);
    if (anchor !== null) {
      if (anchor.length > MAX_ANCHOR_TEXT_LENGTH) {
        throw new SpreadsheetFileError(
          'MALFORMED_SHEET',
          `An anchor cell holds more than ${MAX_ANCHOR_TEXT_LENGTH} characters`,
          { reason: ANCHOR_TOO_LONG_REASON },
        );
      }
      anchoredRows.push({ excelRow, anchor });
    }

    if (!evaluate(format.keep, row, format.layout, layout)) {
      skippedRows += 1;
      continue;
    }
    if (anchor === null) {
      throw new WorkbookInvariantError(`A kept row of ${format.id} has no anchor`);
    }
    rows.push({ excelRow, anchor, data: format.mapRow(reader, anchor) });
  }

  if (rows.length === 0) throw new WorkbookFileRejection('EMPTY_FILE');
  return { rows, skippedRows, firstDataRow, anchoredRows };
}

/** True when the cell already holds a value an export of `spec` could have written. */
function holdsWriteValue(spec: WriteValueSpec, row: CellRow, col: number): boolean {
  if (spec.kind === 'number') {
    // A formula's cached 0, or an empty string, is not a selection.
    const text = cellDecimal(row, col, 'plain');
    return text !== null && new Decimal(text).gt(0);
  }
  const text = cellText(row, col);
  if (text === null) return false;
  if ('pattern' in spec) return spec.pattern.test(text);
  return spec.allow.includes(text);
}

/**
 * The kept rows that already hold a selection: a row counts once when any resolved
 * write column NOT seeded from the source holds a value of its kind (an allow-list
 * member, a pattern match, a number above 0).
 */
export function countPrefilled<S extends LayoutSpec, TRow, TWrite extends string>(
  selected: SelectedFormat<S, TRow, TWrite>,
  rows: readonly ImportedRow<TRow>[],
  resolved: readonly ResolvedWriteColumn<TWrite>[],
): number {
  const columns = resolved.filter(
    (entry) => !selected.format.writeBack[entry.key].seededFromSource,
  );
  if (columns.length === 0) return 0;
  let count = 0;
  for (const row of rows) {
    const cells = selected.grid[row.excelRow - 1] ?? [];
    if (columns.some((entry) => holdsWriteValue(entry.spec, cells, entry.col))) count += 1;
  }
  return count;
}

/** The stem of a sanitized upload name (`.xlsx` dropped); null when there is none. */
function fileStem(sourceFilename: string | null): string | null {
  return sourceFilename === null ? null : sourceFilename.replace(XLSX_EXTENSION_RE, '');
}

/**
 * The stored name of a new list: the first of the typed name, the stem of the
 * sanitized file name, the adapter's fallback (a cell of the file) and the format's
 * default name that is not empty once cleaned (`cleanDisplayName`, UPLOAD_NAME_MAX_LENGTH).
 */
export function deriveName(input: {
  readonly name: string | undefined;
  readonly sourceFilename: string | null;
  readonly fallback: string | null;
  readonly defaultName: string;
}): string {
  const candidates = [input.name, fileStem(input.sourceFilename), input.fallback];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    const cleaned = cleanDisplayName(candidate, UPLOAD_NAME_MAX_LENGTH);
    if (cleaned !== '') return cleaned;
  }
  return cleanDisplayName(input.defaultName, UPLOAD_NAME_MAX_LENGTH);
}

/** Calls `insert` with consecutive chunks of at most IMPORT_INSERT_CHUNK_ROWS items, in order. */
export async function createManyChunked<T>(
  items: readonly T[],
  insert: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  for (let start = 0; start < items.length; start += IMPORT_INSERT_CHUNK_ROWS) {
    await insert(items.slice(start, start + IMPORT_INSERT_CHUNK_ROWS));
  }
}
