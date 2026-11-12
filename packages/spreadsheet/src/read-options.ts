import {
  ABSOLUTE_MAX_BYTES,
  ABSOLUTE_MAX_COLS,
  ABSOLUTE_MAX_ROWS,
  DEFAULT_COL_CAP,
  DEFAULT_MAX_BYTES,
  DEFAULT_ROW_CAP,
} from './constants';

/** What a consumer may ask of readWorkbookGrid; every limit is optional and clamped. */
export interface ReadGridOptions {
  readonly sheetName?: string;
  readonly rowCap?: number;
  readonly colCap?: number;
  readonly maxBytes?: number;
}

/** ReadGridOptions with every limit set: the default, or the override within its ceiling. */
export interface ResolvedReadOptions {
  readonly sheetName?: string;
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
 * Fills in the default limits and clamps every override to its absolute ceiling: the
 * engine owns the limits.
 */
export function resolveReadOptions(options: ReadGridOptions): ResolvedReadOptions {
  return {
    sheetName: options.sheetName,
    rowCap: limit(options.rowCap, DEFAULT_ROW_CAP, ABSOLUTE_MAX_ROWS),
    colCap: limit(options.colCap, DEFAULT_COL_CAP, ABSOLUTE_MAX_COLS),
    maxBytes: limit(options.maxBytes, DEFAULT_MAX_BYTES, ABSOLUTE_MAX_BYTES),
  };
}
