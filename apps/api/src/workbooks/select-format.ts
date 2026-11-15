// Picks the format an uploaded (or stored) workbook is written in, among the formats a
// page accepts for the store's platform, and says what is wrong when none fits: an
// empty sheet, another page's file, or a sheet that is not there.

import {
  normalizeHeader,
  resolveLayout,
  SpreadsheetFileError,
  type CellRow,
  type LayoutSpec,
  type ResolvedLayout,
  type SheetData,
  type SheetSelector,
} from '@pazarsync/spreadsheet';
import type { WorkbookPage } from '@pazarsync/utils';

import { FINGERPRINT_MIN_HEADERS } from '../config/workbook-limits';
import type { WorkbookFormat } from './format';
import type { FormatSummary } from './formats/registry';
import { WorkbookFileRejection } from './workbook-errors';

/** Reads one sheet of a workbook strictly (the engine's `readWorkbookGrid` with `sheet`). */
export type ReadSheet = (file: Buffer, sheet: SheetSelector) => Promise<SheetData>;

export interface SelectedFormat<S extends LayoutSpec, TRow, TWrite extends string> {
  readonly format: WorkbookFormat<S, TRow, TWrite>;
  readonly grid: SheetData;
  readonly layout: ResolvedLayout;
}

/** A data sheet needs a header row and at least one row under it. */
const MIN_GRID_ROWS = 2;

/** The workbook's first sheet, read when no candidate sheet existed to diagnose from. */
const FIRST_SHEET: SheetSelector = { by: 'index', index: 0 };

/**
 * The registered format of ANOTHER page whose fingerprint `headerRow` carries at least
 * FINGERPRINT_MIN_HEADERS headers of: the one with the most hits, registry order
 * breaking a tie. Summaries of `ownPage` are skipped: a broken file of this page is not
 * "another page's file". Null when none qualifies.
 */
export function diagnoseWorkbook(
  headerRow: CellRow,
  summaries: readonly FormatSummary[],
  ownPage: WorkbookPage,
): FormatSummary | null {
  const headers = new Set(headerRow.map(normalizeHeader));
  let best: FormatSummary | null = null;
  let bestHits = 0;
  for (const summary of summaries) {
    if (summary.page === ownPage) continue;
    const hits = summary.fingerprint.filter((name) => headers.has(normalizeHeader(name))).length;
    if (hits >= FINGERPRINT_MIN_HEADERS && hits > bestHits) {
      best = summary;
      bestHits = hits;
    }
  }
  return best;
}

function isSheetNotFound(err: unknown): boolean {
  return err instanceof SpreadsheetFileError && err.code === 'SHEET_NOT_FOUND';
}

/** Row 0 of the workbook's first sheet; an empty row when the workbook has no sheet there. */
async function readFirstHeaderRow(file: Buffer, read: ReadSheet): Promise<CellRow> {
  try {
    const grid = await read(file, FIRST_SHEET);
    return grid[0] ?? [];
  } catch (err) {
    if (isSheetNotFound(err)) return [];
    throw err;
  }
}

function wrongFileForPage(detected: FormatSummary | null): WorkbookFileRejection {
  return new WorkbookFileRejection('WRONG_FILE_FOR_PAGE', {
    detectedFormatId: detected?.id ?? null,
    detectedPlatform: detected?.platform ?? null,
    detectedPage: detected?.page ?? null,
  });
}

/**
 * The first candidate, in order, whose sheet exists, has a data row, and resolves its
 * layout, with that grid and layout. Every candidate is one page's format.
 *
 * When none fits, a WorkbookFileRejection, in this order:
 *   - no candidate at all: UNSUPPORTED_PLATFORM_FORMAT;
 *   - a candidate sheet held only a header row (or nothing): EMPTY_FILE;
 *   - the header row names another page's registered format: WRONG_FILE_FOR_PAGE with
 *     `detectedFormatId`, `detectedPlatform` and `detectedPage`;
 *   - every candidate sheet was missing: SHEET_NOT_FOUND;
 *   - otherwise WRONG_FILE_FOR_PAGE with the three detection fields null.
 * The header row diagnosed is row 0 of the first grid read; when every candidate sheet
 * was missing, the workbook's first sheet is read once more for it.
 *
 * An engine error other than SHEET_NOT_FOUND propagates untouched.
 */
export async function selectFormat<S extends LayoutSpec, TRow, TWrite extends string>(
  file: Buffer,
  candidates: readonly WorkbookFormat<S, TRow, TWrite>[],
  deps: { readonly read: ReadSheet; readonly summaries: readonly FormatSummary[] },
): Promise<SelectedFormat<S, TRow, TWrite>> {
  const ownPage = candidates[0]?.page;
  if (ownPage === undefined) throw new WorkbookFileRejection('UNSUPPORTED_PLATFORM_FORMAT');

  let headerRow: CellRow | null = null;
  let sawEmptySheet = false;
  for (const format of candidates) {
    let grid: SheetData;
    try {
      grid = await deps.read(file, format.sheet);
    } catch (err) {
      if (isSheetNotFound(err)) continue;
      throw err;
    }
    headerRow ??= grid[0] ?? [];
    if (grid.length < MIN_GRID_ROWS) {
      sawEmptySheet = true;
      continue;
    }
    const layout = resolveLayout(format.layout, grid);
    if (layout !== null) return { format, grid, layout };
  }

  if (sawEmptySheet) throw new WorkbookFileRejection('EMPTY_FILE');
  const everySheetMissing = headerRow === null;
  const detected = diagnoseWorkbook(
    headerRow ?? (await readFirstHeaderRow(file, deps.read)),
    deps.summaries,
    ownPage,
  );
  if (detected !== null) throw wrongFileForPage(detected);
  if (everySheetMissing) throw new WorkbookFileRejection('SHEET_NOT_FOUND');
  throw wrongFileForPage(null);
}
