// The import's rehearsal of the export: one patch job that writes the largest value
// each write column can receive into every row the export may patch, run through the
// export's own code path and thrown away. Whatever the export would refuse for a
// structural reason (a shared or array formula, a merged range, the growth cap) is
// refused at upload instead.

import {
  columnIndex,
  type CellPatch,
  type LayoutSpec,
  type PatchAnchor,
} from '@pazarsync/spreadsheet';

import type { AnchoredRow, ReadRowsResult } from './import-rows';
import type { SelectedFormat } from './select-format';
import { WorkbookInvariantError } from './workbook-errors';
import { overwriteFormulaColumns, probeValue, type ResolvedWriteColumn } from './write-columns';

export interface Rehearsal {
  readonly anchors: PatchAnchor[];
  readonly patches: CellPatch[];
  readonly overwriteFormulaColumns: readonly number[];
}

/**
 * The rows the export of an `align` vertical may patch: the kept rows for a cursor-zip
 * export (it pairs items with kept rows by position), every anchored row for an
 * anchor-map export (it patches every row whose anchor matches an item, kept or not).
 */
export function rehearsalTargets<S extends LayoutSpec, TRow>(
  align: 'anchor-map' | 'cursor-zip',
  read: Pick<ReadRowsResult<S, TRow>, 'rows' | 'anchoredRows'>,
): readonly AnchoredRow[] {
  switch (align) {
    case 'cursor-zip':
      return read.rows.map((row) => ({ excelRow: row.excelRow, anchor: row.anchor }));
    case 'anchor-map':
      return read.anchoredRows;
    default: {
      const exhaustive: never = align;
      throw new Error(`Unhandled export alignment: ${String(exhaustive)}`);
    }
  }
}

/**
 * One anchor per target row on the format's anchor column, and the probe value of
 * every resolved write column on every target row, sorted by row then column. No
 * resolved write column gives no patch: there is nothing to rehearse.
 */
export function buildRehearsal<S extends LayoutSpec, TRow, TWrite extends string>(
  selected: SelectedFormat<S, TRow, TWrite>,
  targets: readonly AnchoredRow[],
  resolved: readonly ResolvedWriteColumn<TWrite>[],
): Rehearsal {
  const { format, layout } = selected;
  const anchorCol = columnIndex(format.layout, layout, format.anchor);
  if (anchorCol === null) {
    throw new WorkbookInvariantError(`The anchor column of ${format.id} did not resolve`);
  }
  const anchors: PatchAnchor[] = targets.map((target) => ({
    excelRow: target.excelRow,
    col: anchorCol,
    expected: target.anchor,
  }));
  const patches: CellPatch[] = targets.flatMap((target) =>
    resolved.map(
      (entry): CellPatch => ({
        excelRow: target.excelRow,
        col: entry.col,
        value: probeValue(entry.spec),
      }),
    ),
  );
  patches.sort((a, b) => a.excelRow - b.excelRow || a.col - b.col);
  return { anchors, patches, overwriteFormulaColumns: overwriteFormulaColumns(format, resolved) };
}
