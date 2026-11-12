// The grid a worksheet reads to: rows of cells, rectangular, empty cells null.

/** One cell of a read grid. Dates come only from date-styled numbers and `t="d"` cells. */
export type CellValue = string | number | boolean | Date | null;

/**
 * A read worksheet: rows of cells. Mutable on purpose, so it is a drop-in for the
 * read-excel-file `SheetData` type every API service names.
 */
export type SheetData = CellValue[][];

function isCellValue(value: unknown): value is CellValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value instanceof Date
  );
}

/**
 * True when `value` is an array of arrays of cell values. Indexed loops, not
 * `every`, so a sparse array (a hole reads as `undefined`) is rejected.
 */
export function isSheetData(value: unknown): value is SheetData {
  if (!Array.isArray(value)) return false;
  for (let r = 0; r < value.length; r += 1) {
    const row: unknown = value[r];
    if (!Array.isArray(row)) return false;
    for (let c = 0; c < row.length; c += 1) {
      if (!isCellValue(row[c])) return false;
    }
  }
  return true;
}
