import {
  ABSOLUTE_MAX_COLS,
  MAX_PATCH_ANCHORS,
  MAX_PATCH_CELLS,
  MAX_PATCH_OUTPUTS,
  MAX_PATCH_REQUEST_TEXT_LENGTH,
  MAX_PATCH_TEXT_LENGTH,
} from '../constants';
import {
  isResolvedReadOptions,
  resolveReadOptions,
  type ReadGridOptions,
  type ResolvedReadOptions,
} from '../read-options';
import { cellKey } from '../sheet-meta';
import { isRecord } from '../wire-guards';
import { INVALID_PATCH_REQUEST, assertWritableValue } from './cell-values';

/**
 * What a patch writes into one cell. A `number` value is a plain decimal string; with
 * `scale` it must have exactly that many fraction digits. `clear` empties the cell.
 */
export type CellPatchValue =
  | { readonly kind: 'number'; readonly value: string; readonly scale?: number }
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'clear' };

/** `excelRow` is 1-based (grid index + 1); `col` is 0-based, the grid's column index. */
export interface CellPatch {
  readonly excelRow: number;
  readonly col: number;
  readonly value: CellPatchValue;
}

/** The cell must read, through `cellText`, exactly as `expected`. */
export interface PatchAnchor {
  readonly excelRow: number;
  readonly col: number;
  readonly expected: string;
}

export interface PatchWorkbookOptions extends ReadGridOptions {
  /**
   * Cells the file must hold before any output is written. When every output is
   * empty, nothing is queued: neither the anchors nor the file are checked (the request
   * itself is still validated), and the file is returned as it is.
   */
  readonly anchors?: readonly PatchAnchor[];
  /** One patch list per output file; an empty list means "the stored file itself". */
  readonly outputs: readonly (readonly CellPatch[])[];
  /** 0-based columns whose formula cells may be overwritten; a formula anywhere else is rejected. */
  readonly overwriteFormulaColumns?: readonly number[];
}

/** A validated request: fresh plain objects, each output sorted by row then column. */
export interface ResolvedPatchRequest {
  readonly read: ResolvedReadOptions;
  readonly anchors: readonly PatchAnchor[];
  readonly outputs: readonly (readonly CellPatch[])[];
  readonly overwriteFormulaColumns: readonly number[];
}

function invalid(detail: string): Error {
  return new Error(`${INVALID_PATCH_REQUEST}${detail}`);
}

function assertCounts(
  outputs: readonly (readonly CellPatch[])[],
  anchors: readonly PatchAnchor[],
  formulaColumns: readonly number[],
): void {
  if (outputs.length < 1 || outputs.length > MAX_PATCH_OUTPUTS) {
    throw invalid(`expected 1 to ${MAX_PATCH_OUTPUTS} outputs, got ${outputs.length}`);
  }
  let cells = 0;
  for (const output of outputs) cells += output.length;
  if (cells > MAX_PATCH_CELLS) {
    throw invalid(`${cells} cell patches exceed ${MAX_PATCH_CELLS}`);
  }
  if (anchors.length > MAX_PATCH_ANCHORS) {
    throw invalid(`${anchors.length} anchors exceed ${MAX_PATCH_ANCHORS}`);
  }
  if (formulaColumns.length > ABSOLUTE_MAX_COLS) {
    throw invalid(`${formulaColumns.length} formula columns exceed ${ABSOLUTE_MAX_COLS}`);
  }
}

function valueTextLength(value: CellPatchValue): number {
  switch (value.kind) {
    case 'number':
    case 'text':
      return value.value.length;
    case 'clear':
      return 0;
    default: {
      const _exhaustive: never = value;
      throw new Error(`Unhandled cell value kind: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Sums the length of every value and every anchor `expected` before any of them is
 * walked character by character, so an oversized request is refused in one pass over
 * the counts it already holds and never reaches the worker.
 */
function assertTextBudget(
  outputs: readonly (readonly CellPatch[])[],
  anchors: readonly PatchAnchor[],
): void {
  let total = 0;
  for (const output of outputs) {
    for (const patch of output) total += valueTextLength(patch.value);
  }
  for (const anchor of anchors) total += anchor.expected.length;
  if (total > MAX_PATCH_REQUEST_TEXT_LENGTH) {
    throw invalid(
      `patch and anchor text exceeds ${MAX_PATCH_REQUEST_TEXT_LENGTH} UTF-16 code units`,
    );
  }
}

function assertColumn(col: number, read: ResolvedReadOptions, what: string): void {
  if (!Number.isInteger(col) || col < 0 || col >= read.colCap) {
    throw invalid(`${what} column ${String(col)} is outside 0..${read.colCap - 1}`);
  }
}

function assertCell(excelRow: number, col: number, read: ResolvedReadOptions, what: string): void {
  const lastRow = read.rowCap + 1;
  if (!Number.isInteger(excelRow) || excelRow < 1 || excelRow > lastRow) {
    throw invalid(`${what} row ${String(excelRow)} is outside 1..${lastRow}`);
  }
  assertColumn(col, read, what);
}

function assertRanges(
  outputs: readonly (readonly CellPatch[])[],
  anchors: readonly PatchAnchor[],
  formulaColumns: readonly number[],
  read: ResolvedReadOptions,
): void {
  for (const output of outputs) {
    for (const patch of output) assertCell(patch.excelRow, patch.col, read, 'patch');
  }
  for (const anchor of anchors) assertCell(anchor.excelRow, anchor.col, read, 'anchor');
  for (const col of formulaColumns) assertColumn(col, read, 'formula');
}

function copyValue(value: CellPatchValue): CellPatchValue {
  switch (value.kind) {
    case 'number':
      return value.scale === undefined
        ? { kind: 'number', value: value.value }
        : { kind: 'number', value: value.value, scale: value.scale };
    case 'text':
      return { kind: 'text', value: value.value };
    case 'clear':
      return { kind: 'clear' };
    default: {
      const _exhaustive: never = value;
      throw new Error(`Unhandled cell value kind: ${String(_exhaustive)}`);
    }
  }
}

function compareCells(a: CellPatch, b: CellPatch): number {
  return a.excelRow - b.excelRow || a.col - b.col;
}

/**
 * A fresh plain copy of a patch: each field read once, extra properties dropped. Code
 * that validates a patch and then writes it uses the copy for both, so an object
 * whose getters answer differently on a second read cannot pass one value and write
 * another.
 */
export function copyCellPatch(patch: CellPatch): CellPatch {
  return { excelRow: patch.excelRow, col: patch.col, value: copyValue(patch.value) };
}

/** A sorted copy of one output; two patches on one cell are refused. */
function resolveOutput(output: readonly CellPatch[], index: number): CellPatch[] {
  const sorted = output.map(copyCellPatch);
  sorted.sort(compareCells);
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    if (previous !== undefined && current !== undefined && compareCells(previous, current) === 0) {
      throw invalid(
        `output ${index} patches row ${current.excelRow}, column ${current.col} more than once`,
      );
    }
  }
  return sorted;
}

/** Fresh anchors in the caller's order; two anchors on one cell are refused. */
function resolveAnchors(anchors: readonly PatchAnchor[]): PatchAnchor[] {
  const seen = new Set<number>();
  return anchors.map((anchor): PatchAnchor => {
    const key = cellKey(anchor.excelRow, anchor.col + 1);
    if (seen.has(key)) {
      throw invalid(`two anchors on row ${anchor.excelRow}, column ${anchor.col}`);
    }
    seen.add(key);
    return { excelRow: anchor.excelRow, col: anchor.col, expected: anchor.expected };
  });
}

function resolveFormulaColumns(columns: readonly number[]): number[] {
  const sorted = [...columns].sort((a, b) => a - b);
  return sorted.filter((col, i) => i === 0 || col !== sorted[i - 1]);
}

function assertAnchorExpected(anchor: PatchAnchor): void {
  const { expected } = anchor;
  if (expected.length === 0) {
    throw invalid(`anchor on row ${anchor.excelRow}, column ${anchor.col} expects an empty cell`);
  }
  if (expected.length > MAX_PATCH_TEXT_LENGTH) {
    throw invalid(
      `anchor on row ${anchor.excelRow}, column ${anchor.col} expects ${expected.length} characters, above ${MAX_PATCH_TEXT_LENGTH}`,
    );
  }
  if (expected !== expected.trim()) {
    throw invalid(`anchor on row ${anchor.excelRow}, column ${anchor.col} expects untrimmed text`);
  }
}

/**
 * Validates a patch request on the main thread, before anything is queued, and returns
 * fresh objects with own fields only (they are cloned into the worker): each output
 * sorted by `excelRow`, then `col`; the formula columns sorted and distinct; `read`
 * from `resolveReadOptions`. Throws a plain Error whose message starts with
 * `Invalid patch request: ` (a caller bug). Rules, cheapest first: the counts, the
 * total text budget, the cell ranges, repeated cells, the values, the anchor texts.
 */
export function resolvePatchRequest(options: PatchWorkbookOptions): ResolvedPatchRequest {
  const anchors = options.anchors ?? [];
  const formulaColumns = options.overwriteFormulaColumns ?? [];
  assertCounts(options.outputs, anchors, formulaColumns);
  const read = resolveReadOptions(options);
  assertTextBudget(options.outputs, anchors);
  assertRanges(options.outputs, anchors, formulaColumns, read);

  const outputs = options.outputs.map(resolveOutput);
  const resolvedAnchors = resolveAnchors(anchors);
  for (const output of outputs) {
    for (const patch of output) assertWritableValue(patch.value);
  }
  for (const anchor of resolvedAnchors) assertAnchorExpected(anchor);

  return {
    read,
    anchors: resolvedAnchors,
    outputs,
    overwriteFormulaColumns: resolveFormulaColumns(formulaColumns),
  };
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isCellPatchValue(value: unknown): value is CellPatchValue {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case 'number':
      return (
        typeof value.value === 'string' && (value.scale === undefined || isInteger(value.scale))
      );
    case 'text':
      return typeof value.value === 'string';
    case 'clear':
      return true;
    default:
      return false;
  }
}

function isCellPatch(value: unknown): value is CellPatch {
  return (
    isRecord(value) &&
    isInteger(value.excelRow) &&
    isInteger(value.col) &&
    isCellPatchValue(value.value)
  );
}

function isPatchAnchor(value: unknown): value is PatchAnchor {
  return (
    isRecord(value) &&
    isInteger(value.excelRow) &&
    isInteger(value.col) &&
    typeof value.expected === 'string'
  );
}

/**
 * True when `value` is an array whose every item passes `guard`. Indexed, not
 * `every`, so a sparse array (a hole reads as `undefined`) is rejected.
 */
function isArrayOf<T>(value: unknown, guard: (item: unknown) => item is T): value is T[] {
  if (!Array.isArray(value)) return false;
  for (let i = 0; i < value.length; i += 1) {
    const item: unknown = value[i];
    if (!guard(item)) return false;
  }
  return true;
}

function isOutput(value: unknown): value is CellPatch[] {
  return isArrayOf(value, isCellPatch);
}

/**
 * The worker-side shape check of a request, in one linear pass: `read` with
 * `isResolvedReadOptions`, every row, column, formula column and scale an integer,
 * every value of a known kind. The value and order rules are not repeated here:
 * `applyCellPatches` enforces them where the bytes are written.
 */
export function isResolvedPatchRequest(value: unknown): value is ResolvedPatchRequest {
  return (
    isRecord(value) &&
    isResolvedReadOptions(value.read) &&
    isArrayOf(value.anchors, isPatchAnchor) &&
    isArrayOf(value.outputs, isOutput) &&
    isArrayOf(value.overwriteFormulaColumns, isInteger)
  );
}
