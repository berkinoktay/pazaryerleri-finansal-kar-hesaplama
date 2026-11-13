import { SPREADSHEET_MAIN_NAMESPACES } from '../../src/constants';
import type { CellPatch } from '../../src/patch/patch-request';

// Builders shared by the export patch path's tests: the worksheet index, the cell
// patcher, the pipeline and the worker job. Define them here only, never in a test file.

const TRANSITIONAL_MAIN_NAMESPACE = SPREADSHEET_MAIN_NAMESPACES[0];
if (TRANSITIONAL_MAIN_NAMESPACE === undefined) {
  throw new Error('SPREADSHEET_MAIN_NAMESPACES lists no namespace');
}

/** The transitional SpreadsheetML main namespace. */
export const MAIN_NAMESPACE: string = TRANSITIONAL_MAIN_NAMESPACE;

const encoder = new TextEncoder();

/** The bytes of a worksheet part whose `sheetData` holds `body`. */
export function sheet(body: string, rootAttributes = `xmlns="${MAIN_NAMESPACE}"`): Uint8Array {
  return encoder.encode(
    `<?xml version="1.0" encoding="UTF-8"?><worksheet ${rootAttributes}><sheetData>${body}</sheetData></worksheet>`,
  );
}

/** A number patch; `col` is 0-based. */
export function num(excelRow: number, col: number, value: string, scale?: number): CellPatch {
  if (scale === undefined) return { excelRow, col, value: { kind: 'number', value } };
  return { excelRow, col, value: { kind: 'number', value, scale } };
}

/** A text patch; `col` is 0-based. */
export function text(excelRow: number, col: number, value: string): CellPatch {
  return { excelRow, col, value: { kind: 'text', value } };
}

/** A patch that empties the cell; `col` is 0-based. */
export function clear(excelRow: number, col: number): CellPatch {
  return { excelRow, col, value: { kind: 'clear' } };
}
