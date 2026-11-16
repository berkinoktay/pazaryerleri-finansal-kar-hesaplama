// The pure plan of an export: which cells of the stored sheet each output file
// changes, and which anchor cells the patcher must find unchanged first. It pairs the
// stored file's rows with the record's items (by position for a cursor-zip vertical,
// by anchor for an anchor-map one), asks the adapter what each row's write columns
// hold, and keeps only the values that differ from the stored cells.

import { Decimal } from 'decimal.js';

import {
  cellDecimal,
  cellText,
  columnIndex,
  evaluate,
  MAX_PATCH_REQUEST_TEXT_LENGTH,
  MAX_PATCH_TEXT_LENGTH,
  type CellPatch,
  type CellPatchValue,
  type CellRow,
  type LayoutSpec,
  type PatchAnchor,
  type ResolvedLayout,
  type SheetData,
} from '@pazarsync/spreadsheet';
import { planWindowFiles } from '@pazarsync/utils';

import { WorkbookConflictError } from '../lib/errors';
import type {
  CellWrite,
  ExportGroup,
  SourceCells,
  WorkbookExportAdapter,
  WriteContext,
} from './adapter';
import type { FilenamePolicy, WorkbookFormat, WriteValueSpec } from './format';
import { WorkbookInvariantError } from './workbook-errors';
import {
  assertPlannedWriteValue,
  missingExportRequirement,
  overwriteFormulaColumns,
  type ResolvedWriteColumn,
} from './write-columns';

/** One output file: its window's day count (null for a single file or the empty fallback). */
export interface PlannedFile {
  readonly dayCount: number | null;
  readonly patches: CellPatch[];
}

export interface ExportPlan {
  readonly files: readonly PlannedFile[];
  readonly anchors: PatchAnchor[];
  readonly overwriteFormulaColumns: readonly number[];
}

type PlanAdapter<S extends LayoutSpec, TRow, TItem, TWrite extends string> = Pick<
  WorkbookExportAdapter<S, TRow, TItem, TWrite>,
  'align' | 'files' | 'anchorOf' | 'pick' | 'resolveWriteBack'
>;

export interface PlanExportInput<S extends LayoutSpec, TRow, TItem, TWrite extends string> {
  readonly format: WorkbookFormat<S, TRow, TWrite>;
  readonly grid: SheetData;
  readonly layout: ResolvedLayout;
  /** `resolveWriteColumns(format, layout)`, resolved where its MALFORMED_SHEET is mapped. */
  readonly resolved: readonly ResolvedWriteColumn<TWrite>[];
  readonly groups: readonly ExportGroup<TItem>[];
  readonly adapter: PlanAdapter<S, TRow, TItem, TWrite>;
}

/** One data row of the stored sheet: its grid index, its cells, its anchor text. */
interface DataRow {
  readonly index: number;
  readonly cells: CellRow;
  readonly anchor: string | null;
}

/** One row the adapter is asked about, with what it is asked. */
interface RowWrite<TItem> {
  readonly row: DataRow;
  readonly anchor: string;
  readonly window: WriteContext<TItem, string>['window'];
  readonly pick: string | null;
  readonly items: WriteContext<TItem, string>['items'];
}

/** A file being planned: its day count and the rows the adapter writes into it. */
interface FileRows<TItem> {
  readonly dayCount: number | null;
  readonly rows: readonly RowWrite<TItem>[];
}

/** The item that carries an anchor in one group, and its pick. */
interface AnchorEntry<TItem> {
  readonly item: TItem;
  readonly pick: string;
}

/** One group of a period-windows export with its anchor map. */
interface MappedGroup<TItem> {
  readonly tag: number | null;
  readonly map: ReadonlyMap<string, AnchorEntry<TItem>>;
}

function anchorColumn<S extends LayoutSpec, TRow, TWrite extends string>(
  format: WorkbookFormat<S, TRow, TWrite>,
  layout: ResolvedLayout,
): number {
  const col = columnIndex(format.layout, layout, format.anchor);
  if (col === null) {
    throw new WorkbookInvariantError(`The anchor column of ${format.id} did not resolve`);
  }
  return col;
}

/** Every row below the header, kept or not, with its anchor text. */
function dataRows(grid: SheetData, layout: ResolvedLayout, anchorCol: number): DataRow[] {
  const rows: DataRow[] = [];
  for (let index = layout.headerRowIndex + 1; index < grid.length; index += 1) {
    const cells = grid[index] ?? [];
    rows.push({ index, cells, anchor: cellText(cells, anchorCol) });
  }
  return rows;
}

/**
 * cursor-zip: the kept rows, in order, pair with the first group's items by position.
 * A different count, or a row whose anchor is not its item's, is ROW_MISMATCH.
 */
function cursorZipRows<S extends LayoutSpec, TRow, TItem, TWrite extends string>(
  input: PlanExportInput<S, TRow, TItem, TWrite>,
  rows: readonly DataRow[],
): RowWrite<TItem>[] {
  const { format, layout, groups, adapter } = input;
  const group = groups[0];
  const items = group?.items ?? [];
  const tag = group?.tag ?? null;
  const kept = rows.filter((row) => evaluate(format.keep, row.cells, format.layout, layout));
  if (kept.length !== items.length) throw new WorkbookConflictError('ROW_MISMATCH');
  return kept.map((row, position) => {
    const item = items[position];
    if (item === undefined || row.anchor === null || row.anchor !== adapter.anchorOf(item)) {
      throw new WorkbookConflictError('ROW_MISMATCH');
    }
    return { row, anchor: row.anchor, window: null, pick: null, items: [{ tag, item }] };
  });
}

/** Anchor to the last item, in query order, that carries a pick; an item without one never enters. */
function anchorMap<S extends LayoutSpec, TRow, TItem, TWrite extends string>(
  group: ExportGroup<TItem>,
  adapter: PlanAdapter<S, TRow, TItem, TWrite>,
): ReadonlyMap<string, AnchorEntry<TItem>> {
  const map = new Map<string, AnchorEntry<TItem>>();
  for (const item of group.items) {
    const pick = adapter.pick(item);
    if (pick !== null) map.set(adapter.anchorOf(item), { item, pick });
  }
  return map;
}

/** anchor-map, one file: every data row whose anchor the first group's map holds. */
function anchorMapRows<S extends LayoutSpec, TRow, TItem, TWrite extends string>(
  input: PlanExportInput<S, TRow, TItem, TWrite>,
  rows: readonly DataRow[],
): RowWrite<TItem>[] {
  const group = input.groups[0];
  if (group === undefined) return [];
  const map = anchorMap(group, input.adapter);
  const writes: RowWrite<TItem>[] = [];
  for (const row of rows) {
    if (row.anchor === null) continue;
    const entry = map.get(row.anchor);
    if (entry === undefined) continue;
    writes.push({
      row,
      anchor: row.anchor,
      window: null,
      pick: entry.pick,
      items: [{ tag: group.tag, item: entry.item }],
    });
  }
  return writes;
}

function windowLabelUnit(policy: FilenamePolicy): string {
  if (policy.kind !== 'window') {
    throw new WorkbookInvariantError('A period-windows export needs a window filename policy');
  }
  return policy.labelUnit;
}

function picksOf<TItem>(map: ReadonlyMap<string, AnchorEntry<TItem>>): Map<string, string> {
  const picks = new Map<string, string>();
  for (const [anchor, entry] of map) picks.set(anchor, entry.pick);
  return picks;
}

/**
 * anchor-map, one file per planned window: the groups' picks bucketed by
 * `planWindowFiles`; each file writes every data row whose anchor it picks, with the
 * window, the pick and the winning item of each group it covers (a group without one
 * adds nothing). No planned file gives one file with nothing to write.
 */
function periodWindowFiles<S extends LayoutSpec, TRow, TItem, TWrite extends string>(
  input: PlanExportInput<S, TRow, TItem, TWrite>,
  rows: readonly DataRow[],
): FileRows<TItem>[] {
  const labelUnit = windowLabelUnit(input.format.filename);
  const groups: MappedGroup<TItem>[] = input.groups.map((group) => ({
    tag: group.tag,
    map: anchorMap(group, input.adapter),
  }));
  const planned = planWindowFiles(
    groups.map((group) => ({ dayCount: group.tag, picks: picksOf(group.map) })),
  );
  if (planned.length === 0) return [{ dayCount: null, rows: [] }];

  return planned.map((file) => {
    const window = { dayCount: file.dayCount, label: `${file.dayCount} ${labelUnit}` };
    const fileRows: RowWrite<TItem>[] = [];
    for (const row of rows) {
      if (row.anchor === null) continue;
      const anchor = row.anchor;
      const pick = file.picks.get(anchor);
      if (pick === undefined) continue;
      const items = file.periodIndices.flatMap((index) => {
        const group = groups[index];
        const entry = group?.map.get(anchor);
        return group === undefined || entry === undefined
          ? []
          : [{ tag: group.tag, item: entry.item }];
      });
      fileRows.push({ row, anchor, window, pick, items });
    }
    return { dayCount: file.dayCount, rows: fileRows };
  });
}

function filesToWrite<S extends LayoutSpec, TRow, TItem, TWrite extends string>(
  input: PlanExportInput<S, TRow, TItem, TWrite>,
  rows: readonly DataRow[],
): FileRows<TItem>[] {
  const { align, files } = input.adapter;
  switch (align) {
    case 'cursor-zip':
      if (files !== 'single') {
        throw new WorkbookInvariantError('A cursor-zip export writes a single file');
      }
      return [{ dayCount: null, rows: cursorZipRows(input, rows) }];
    case 'anchor-map':
      return files === 'single'
        ? [{ dayCount: null, rows: anchorMapRows(input, rows) }]
        : periodWindowFiles(input, rows);
    default: {
      const exhaustive: never = align;
      throw new Error(`Unhandled export alignment: ${String(exhaustive)}`);
    }
  }
}

/**
 * The stored cells of one row under the write columns. A key with several block
 * columns reads its first block's column; null when the key resolved to no column.
 */
function sourceCells<TWrite extends string>(
  cells: CellRow,
  resolved: readonly ResolvedWriteColumn<TWrite>[],
): SourceCells<TWrite> {
  const columnOf = (key: TWrite): number | null =>
    resolved.find((entry) => entry.key === key)?.col ?? null;
  return {
    text: (key) => cellText(cells, columnOf(key)),
    decimal: (key) => cellDecimal(cells, columnOf(key), 'plain'),
  };
}

/** True when the stored cell already holds `value`: the same text, or the same number. */
function equalsSource(spec: WriteValueSpec, cells: CellRow, col: number, value: string): boolean {
  if (spec.kind === 'text') return cellText(cells, col) === value;
  const stored = cellDecimal(cells, col, 'plain');
  return stored !== null && new Decimal(stored).eq(value);
}

/** True when the stored cell holds nothing the import reads: absent, null or blank text. */
function isBlankCell(cells: CellRow, col: number): boolean {
  const value = cells[col];
  return (
    value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
  );
}

function patchValue(spec: WriteValueSpec, value: string): CellPatchValue {
  if (spec.kind === 'text') return { kind: 'text', value };
  return spec.scale === undefined
    ? { kind: 'number', value }
    : { kind: 'number', value, scale: spec.scale };
}

/**
 * The patches of one row's writes: a write whose (key, tag) resolved to no column is
 * dropped; a null value clears the cell only when its column clears when unselected
 * and the stored cell is not already blank; a value is checked against its column's
 * rule and dropped when the stored cell already holds it, so an export that changes
 * nothing patches nothing. Two writes on one cell are our bug.
 */
function rowPatches<S extends LayoutSpec, TRow, TWrite extends string>(
  format: WorkbookFormat<S, TRow, TWrite>,
  resolved: readonly ResolvedWriteColumn<TWrite>[],
  row: DataRow,
  writes: readonly CellWrite<TWrite>[],
): CellPatch[] {
  const excelRow = row.index + 1;
  const patches: CellPatch[] = [];
  const written = new Set<number>();
  for (const write of writes) {
    const tag = write.tag ?? null;
    const entry = resolved.find((column) => column.key === write.key && column.tag === tag);
    if (entry === undefined) continue;
    if (written.has(entry.col)) {
      throw new WorkbookInvariantError(`Two writes land on column ${entry.col} of one row`);
    }
    written.add(entry.col);
    if (write.value === null) {
      if (format.writeBack[write.key].clearWhenUnselected && !isBlankCell(row.cells, entry.col)) {
        patches.push({ excelRow, col: entry.col, value: { kind: 'clear' } });
      }
      continue;
    }
    assertPlannedWriteValue(entry.spec, write.value);
    if (equalsSource(entry.spec, row.cells, entry.col, write.value)) continue;
    patches.push({ excelRow, col: entry.col, value: patchValue(entry.spec, write.value) });
  }
  return patches;
}

function patchTextLength(value: CellPatchValue): number {
  switch (value.kind) {
    case 'number':
    case 'text':
      return value.value.length;
    case 'clear':
      return 0;
    default: {
      const _exhaustive: never = value;
      throw new WorkbookInvariantError(`Unhandled cell value kind: ${String(_exhaustive)}`);
    }
  }
}

/**
 * The plan against the patcher's text limits, which refuse an over-long request as a
 * caller bug (a plain Error, so a 500). The anchors are the stored file's own cells:
 * one longer than Excel's cell limit, or anchors and values together above the request
 * budget, can only come from a crafted file stored before the import bounded its
 * anchors, so either refuses the stored file. Summed over every file, the total is
 * never less than one engine call's share.
 */
function assertPatchTextBudget(
  files: readonly PlannedFile[],
  anchors: readonly PatchAnchor[],
): void {
  let total = 0;
  for (const anchor of anchors) {
    if (anchor.expected.length > MAX_PATCH_TEXT_LENGTH) {
      throw new WorkbookConflictError('STORED_FILE_UNREADABLE');
    }
    total += anchor.expected.length;
  }
  for (const file of files) {
    for (const patch of file.patches) total += patchTextLength(patch.value);
  }
  if (total > MAX_PATCH_REQUEST_TEXT_LENGTH) {
    throw new WorkbookConflictError('STORED_FILE_UNREADABLE');
  }
}

/**
 * The export of one stored file: per output file the cells to patch, sorted by row then
 * column; one anchor per row that has a patch in any file (its anchor cell must still
 * read the row's anchor); and the write columns whose formula cells may be overwritten.
 *
 * Throws WorkbookConflictError NO_WRITEBACK_COLUMN when an `exportRequires` group has
 * no resolved column, ROW_MISMATCH when a cursor-zip file's kept rows and items
 * disagree, STORED_FILE_UNREADABLE when the stored anchors exceed the patcher's text
 * limits; UnwritableStoredValueError when the adapter writes a value its column may not
 * receive (the record's stored value; `exportWorkbook` answers it with 409).
 */
export function planExport<S extends LayoutSpec, TRow, TItem, TWrite extends string>(
  input: PlanExportInput<S, TRow, TItem, TWrite>,
): ExportPlan {
  const { format, resolved, adapter } = input;
  if (missingExportRequirement(format, resolved)) {
    throw new WorkbookConflictError('NO_WRITEBACK_COLUMN');
  }
  const anchorCol = anchorColumn(format, input.layout);
  const rows = dataRows(input.grid, input.layout, anchorCol);
  const anchorByRow = new Map<number, string>();

  const files = filesToWrite(input, rows).map((file): PlannedFile => {
    const patches: CellPatch[] = [];
    for (const { row, anchor, window, pick, items } of file.rows) {
      const writes = adapter.resolveWriteBack({
        window,
        pick,
        items,
        source: sourceCells(row.cells, resolved),
      });
      const cellPatches = rowPatches(format, resolved, row, writes);
      if (cellPatches.length > 0) anchorByRow.set(row.index + 1, anchor);
      patches.push(...cellPatches);
    }
    patches.sort((a, b) => a.excelRow - b.excelRow || a.col - b.col);
    return { dayCount: file.dayCount, patches };
  });

  const anchors: PatchAnchor[] = [...anchorByRow]
    .sort(([a], [b]) => a - b)
    .map(([excelRow, expected]) => ({ excelRow, col: anchorCol, expected }));
  assertPatchTextBudget(files, anchors);
  return { files, anchors, overwriteFormulaColumns: overwriteFormulaColumns(format, resolved) };
}
