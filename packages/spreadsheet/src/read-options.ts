import {
  ABSOLUTE_MAX_BYTES,
  ABSOLUTE_MAX_COLS,
  ABSOLUTE_MAX_ROWS,
  DEFAULT_COL_CAP,
  DEFAULT_MAX_BYTES,
  DEFAULT_ROW_CAP,
} from './constants';
import { isPositiveInteger, isRecord } from './wire-guards';

/**
 * The sheet to read, strictly: by its exact name (the first match), or by its 0-based
 * position among the workbook's named `<sheet>` entries in document order, hidden and
 * very hidden ones included. A selector that matches no sheet is SHEET_NOT_FOUND;
 * there is no fallback to the first sheet.
 */
export type SheetSelector =
  | { readonly by: 'name'; readonly name: string }
  | { readonly by: 'index'; readonly index: number };

/**
 * What a consumer may ask of readWorkbookGrid; every limit is optional and clamped.
 * `sheet` selects strictly; `sheetName` is the legacy lookup, which falls back to the
 * first sheet. At most one of them may be given.
 */
export interface ReadGridOptions {
  readonly sheetName?: string;
  readonly sheet?: SheetSelector;
  readonly rowCap?: number;
  readonly colCap?: number;
  readonly maxBytes?: number;
}

/** ReadGridOptions with every limit set: the default, or the override within its ceiling. */
export interface ResolvedReadOptions {
  readonly sheetName?: string;
  readonly sheet?: SheetSelector;
  readonly rowCap: number;
  readonly colCap: number;
  readonly maxBytes: number;
}

/**
 * An override that is a positive integer, clamped to `ceiling`; anything else (absent,
 * zero, negative, fractional, NaN, Infinity) is the default. A NaN must never reach a
 * cap: every comparison against NaN is false, so it would switch the cap off.
 */
function limit(override: number | undefined, fallback: number, ceiling: number): number {
  if (override === undefined || !Number.isInteger(override) || override <= 0) return fallback;
  return Math.min(override, ceiling);
}

/**
 * A copy of `sheet` with only the selector's own fields (it crosses to the parse
 * worker). Throws Error for an index that is not a non-negative integer: a programmer
 * error, not a property of the file.
 */
function resolveSheet(sheet: SheetSelector): SheetSelector {
  switch (sheet.by) {
    case 'name':
      return { by: 'name', name: sheet.name };
    case 'index':
      if (!Number.isInteger(sheet.index) || sheet.index < 0) {
        throw new Error(`Sheet index must be a non-negative integer, got ${String(sheet.index)}`);
      }
      return { by: 'index', index: sheet.index };
    default: {
      const _exhaustive: never = sheet;
      throw new Error(`Unhandled sheet selector: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Fills in the default limits and clamps every override to its absolute ceiling: the
 * engine owns the limits. Throws Error, before any parse is queued, when both `sheet`
 * and `sheetName` are given or the sheet index is not a non-negative integer.
 */
export function resolveReadOptions(options: ReadGridOptions): ResolvedReadOptions {
  if (options.sheet !== undefined && options.sheetName !== undefined) {
    throw new Error('Pass either sheet or sheetName, not both');
  }
  return {
    sheetName: options.sheetName,
    sheet: options.sheet === undefined ? undefined : resolveSheet(options.sheet),
    rowCap: limit(options.rowCap, DEFAULT_ROW_CAP, ABSOLUTE_MAX_ROWS),
    colCap: limit(options.colCap, DEFAULT_COL_CAP, ABSOLUTE_MAX_COLS),
    maxBytes: limit(options.maxBytes, DEFAULT_MAX_BYTES, ABSOLUTE_MAX_BYTES),
  };
}

function isSheetSelector(value: unknown): value is SheetSelector {
  if (!isRecord(value)) return false;
  switch (value.by) {
    case 'name':
      return typeof value.name === 'string';
    case 'index':
      return typeof value.index === 'number' && Number.isInteger(value.index) && value.index >= 0;
    default:
      return false;
  }
}

/** Resolved options; a strict `sheet` selector and a legacy `sheetName` never travel together. */
export function isResolvedReadOptions(value: unknown): value is ResolvedReadOptions {
  return (
    isRecord(value) &&
    (value.sheetName === undefined || typeof value.sheetName === 'string') &&
    (value.sheet === undefined || isSheetSelector(value.sheet)) &&
    (value.sheet === undefined || value.sheetName === undefined) &&
    isPositiveInteger(value.rowCap) &&
    isPositiveInteger(value.colCap) &&
    isPositiveInteger(value.maxBytes)
  );
}
