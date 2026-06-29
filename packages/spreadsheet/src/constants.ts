// Absolute ceilings that clamp consumer overrides; the engine owns the limits.
export const DEFAULT_ROW_CAP = 5_000;
export const ABSOLUTE_MAX_ROWS = 20_000;
export const DEFAULT_COL_CAP = 64;
export const ABSOLUTE_MAX_COLS = 256;
export const MAX_TOTAL_CELLS = 1_000_000;
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
export const ABSOLUTE_MAX_BYTES = 25 * 1024 * 1024;
export const MAX_DECOMPRESSED_BYTES = 200 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 64;
export const MAX_CELL_TEXT_LENGTH = 32_767; // Excel cell limit
export const MAX_ERROR_VALUE_LENGTH = 256; // CellError.value is truncated at the surface

// 'PK\x03\x04' — zip local-file-header signature (xlsx is a zip).
export const XLSX_MAGIC: readonly number[] = [0x50, 0x4b, 0x03, 0x04];
export const XLSX_EXTENSION = '.xlsx';

// Formula/CSV injection: text cells starting with these characters (first non-whitespace) are neutralized.
export const FORMULA_PREFIX_CHARS: readonly string[] = ['=', '+', '-', '@', '\t', '\r', '\n'];
