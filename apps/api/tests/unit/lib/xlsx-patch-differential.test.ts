// The new byte-preserving patcher (@pazarsync/spreadsheet, through patchFixture)
// against the old one (patchXlsxCells) on every export vertical's real cell set. Both
// outputs must read back as the same grid: the source grid with the table's cells
// written. This is the evidence that a service can swap patchers without changing
// what the marketplace reads.
//
// Each vertical's table states every cell the way its export service writes it. Some
// writes repeat what the source already holds (an export does the same), so the test
// never counts differing cells against the table's size: it builds the expected grid,
// and checks per written column that the table changes at least one cell.
//
// The sheet names and labels below are module-private constants of the export
// services, copied byte-exact. They hold non-ASCII characters, written as \u escapes
// so this file stays ASCII.

import { readFileSync } from 'node:fs';

import {
  readWorkbookGrid,
  type CellPatch,
  type CellValue,
  type SheetData,
} from '@pazarsync/spreadsheet';
import { patchFixture } from '@pazarsync/spreadsheet/testing';
import { describe, expect, it, vi } from 'vitest';

import { patchXlsxCells, type XlsxCellValue, type XlsxRowPatches } from '@/lib/xlsx-patch';

// The reads run in the engine's worker; its cold start alone can pass vitest's 5 s
// default under load, so this file waits longer. A real hang still fails.
const DIFFERENTIAL_TEST_TIMEOUT_MS = 60_000;
vi.setConfig({ testTimeout: DIFFERENTIAL_TEST_TIMEOUT_MS });

// --- Copied service constants -----------------------------------------------

// tariff-export-commons.ts WINDOW_SELECTION_LABEL_UNIT.
const WINDOW_SELECTION_LABEL_UNIT = 'G\u00fcnl\u00fck Fiyat';
// commission-tariff-export.service.ts SHEET_NAME.
const COMMISSION_SHEET_NAME = 'KomisyonTarifeleri\u00dcr\u00fcnleri';
// plus-commission-tariff-export.service.ts SHEET_NAME and NOT_CANCELLED.
const PLUS_SHEET_NAME = 'TyPlus\u00dcr\u00fcnleri';
const PLUS_NOT_CANCELLED = 'Hay\u0131r';
// advantage-tariff-export.service.ts SHEET_NAME.
const ADVANTAGE_SHEET_NAME = 'Y\u0131ld\u0131zl\u0131\u00dcr\u00fcnEtiketleri';
// flash-product-export.service.ts SHEET_NAME and the three update labels, in source order.
const FLASH_SHEET_NAME = 'Teklif\u00dcr\u00fcnleri';
const FLASH_UPDATE_LABEL_24H = '24 Saat';
const FLASH_UPDATE_LABEL_3H = '3 Saat';
const FLASH_UPDATE_LABEL_CUSTOM = 'Senin Belirledi\u011fin Fla\u015f Fiyat\u0131';
const FLASH_UPDATE_LABELS: readonly string[] = [
  FLASH_UPDATE_LABEL_24H,
  FLASH_UPDATE_LABEL_3H,
  FLASH_UPDATE_LABEL_CUSTOM,
];
// discount-list-layout.ts DISCOUNT_SHEET_NAME, DISCOUNT_INCLUDED_YES and DISCOUNT_INCLUDED_NO.
const DISCOUNT_SHEET_NAME = '\u00dcr\u00fcnler';
const DISCOUNT_INCLUDED_YES = 'Evet';
const DISCOUNT_INCLUDED_NO = 'Hay\u0131r';

// --- Value rules ------------------------------------------------------------

// Row 1 holds the headers; "data row" means FIRST_DATA_ROW to the fixture's last row.
const FIRST_DATA_ROW = 2;
// A number cell is (NUMBER_BASE + excelRow) with NUMBER_SCALE fraction digits unless the
// table gives a literal: test input formatted from the row number, not an amount.
const NUMBER_BASE = 1000;
const NUMBER_SCALE = 2;
// Literal numbers the Plus exports write with no fixed scale.
const LITERAL_NUMBER_A = '15.4';
const LITERAL_NUMBER_B = '12.75';
// Window lengths of the N-day selection labels.
const SPLIT_WEEK_FIRST_DAYS = 3;
const SPLIT_WEEK_SECOND_DAYS = 4;
const FULL_WEEK_DAYS = 7;
// The campaign table writes every third data row (rows 2, 5, 8, ...).
const CAMPAIGN_ROW_STRIDE = 3;

type WrittenKind = 'number' | 'text';

/** One cell of a vertical's table: 1-based Excel row, 0-based grid column. */
interface TableCell {
  readonly excelRow: number;
  readonly col: number;
  readonly kind: WrittenKind;
  readonly value: string;
}

/** The read option both patchers and all three reads share: a sheet name, or the first sheet. */
interface ReadOption {
  readonly sheetName?: string;
}

interface Vertical {
  readonly name: string;
  readonly fixture: string;
  readonly read: ReadOption;
  /** The fixture's last row (the source grid's length). */
  readonly lastRow: number;
  readonly cells: (dataRows: readonly number[]) => readonly TableCell[];
}

function defaultNumber(excelRow: number): string {
  return (NUMBER_BASE + excelRow).toFixed(NUMBER_SCALE);
}

function num(excelRow: number, col: number, value: string = defaultNumber(excelRow)): TableCell {
  return { excelRow, col, kind: 'number', value };
}

function text(excelRow: number, col: number, value: string): TableCell {
  return { excelRow, col, kind: 'text', value };
}

function isEven(excelRow: number): boolean {
  return excelRow % 2 === 0;
}

/** Trendyol's N-day selection label, built as tariff-export-commons.ts builds it. */
function windowLabel(days: number): string {
  return `${days} ${WINDOW_SELECTION_LABEL_UNIT}`;
}

/** The 3-day label on even rows, the 4-day label on odd rows. */
function splitWeekLabel(excelRow: number): string {
  return windowLabel(isEven(excelRow) ? SPLIT_WEEK_FIRST_DAYS : SPLIT_WEEK_SECOND_DAYS);
}

/** The three flash labels cycled over the data rows, starting at the first. */
function flashLabel(excelRow: number): string {
  const label = FLASH_UPDATE_LABELS[(excelRow - FIRST_DATA_ROW) % FLASH_UPDATE_LABELS.length];
  if (label === undefined) throw new Error(`no flash label for row ${excelRow}`);
  return label;
}

function dataRows(lastRow: number): number[] {
  const rows: number[] = [];
  for (let row = FIRST_DATA_ROW; row <= lastRow; row += 1) rows.push(row);
  return rows;
}

// --- The verticals ----------------------------------------------------------

const VERTICALS: readonly Vertical[] = [
  {
    name: 'commission, two periods',
    fixture: 'trendyol-commission-tariff.xlsx',
    read: { sheetName: COMMISSION_SHEET_NAME },
    lastRow: 56,
    cells: (rows) => rows.flatMap((row) => [num(row, 27), text(row, 30, splitWeekLabel(row))]),
  },
  {
    name: 'commission, one period',
    fixture: 'trendyol-tariff-1period.xlsx',
    read: { sheetName: COMMISSION_SHEET_NAME },
    lastRow: 56,
    cells: (rows) =>
      rows.flatMap((row) => [num(row, 22), text(row, 24, windowLabel(FULL_WEEK_DAYS))]),
  },
  {
    name: 'plus',
    fixture: 'trendyol-plus-tariff.xlsx',
    read: { sheetName: PLUS_SHEET_NAME },
    lastRow: 56,
    // Columns 17 to 19 are formula cells; patchFixture overwrites every column by default.
    cells: (rows) =>
      rows.flatMap((row) => [
        num(row, 16),
        text(row, 17, windowLabel(FULL_WEEK_DAYS)),
        num(row, 18, LITERAL_NUMBER_A),
        text(row, 19, PLUS_NOT_CANCELLED),
      ]),
  },
  {
    name: 'plus, split week',
    fixture: 'trendyol-plus-tariff-3ve4.xlsx',
    read: { sheetName: PLUS_SHEET_NAME },
    lastRow: 34,
    cells: (rows) =>
      rows.flatMap((row) => [
        num(row, 18),
        text(row, 19, splitWeekLabel(row)),
        isEven(row) ? num(row, 21, LITERAL_NUMBER_A) : num(row, 22, LITERAL_NUMBER_B),
        text(row, 23, PLUS_NOT_CANCELLED),
      ]),
  },
  {
    name: 'advantage',
    fixture: 'trendyol-advantage-tariff.xlsx',
    read: { sheetName: ADVANTAGE_SHEET_NAME },
    lastRow: 72,
    cells: (rows) => rows.filter(isEven).map((row) => num(row, 15)),
  },
  {
    name: 'flash',
    fixture: 'trendyol-flash-products.xlsx',
    read: { sheetName: FLASH_SHEET_NAME },
    lastRow: 123,
    cells: (rows) =>
      rows.flatMap((row) => {
        const label = text(row, 9, flashLabel(row));
        return label.value === FLASH_UPDATE_LABEL_CUSTOM ? [label, num(row, 12)] : [label];
      }),
  },
  {
    name: 'campaign',
    fixture: 'marketplace-campaign-sample.xlsx',
    read: {},
    lastRow: 69,
    cells: (rows) =>
      rows
        .filter((row) => (row - FIRST_DATA_ROW) % CAMPAIGN_ROW_STRIDE === 0)
        .map((row) => num(row, 11)),
  },
  {
    name: 'discount',
    fixture: 'trendyol-discount-products.xlsx',
    read: { sheetName: DISCOUNT_SHEET_NAME },
    lastRow: 5,
    // Column 8 holds t="s" cells; row 3 stays untouched.
    cells: () => [
      text(2, 8, DISCOUNT_INCLUDED_YES),
      text(4, 8, DISCOUNT_INCLUDED_YES),
      text(5, 8, DISCOUNT_INCLUDED_NO),
    ],
  },
];

// --- Both patch lists and the expected grid, from one table -----------------

function toOldValue(cell: TableCell): XlsxCellValue {
  switch (cell.kind) {
    case 'number':
      return { kind: 'number', value: cell.value };
    case 'text':
      return { kind: 'inlineStr', value: cell.value };
    default: {
      const _exhaustive: never = cell.kind;
      throw new Error(`Unhandled cell kind: ${String(_exhaustive)}`);
    }
  }
}

function toRowPatches(cells: readonly TableCell[]): XlsxRowPatches {
  const rows = new Map<number, Map<number, XlsxCellValue>>();
  for (const cell of cells) {
    let row = rows.get(cell.excelRow);
    if (row === undefined) {
      row = new Map<number, XlsxCellValue>();
      rows.set(cell.excelRow, row);
    }
    row.set(cell.col, toOldValue(cell));
  }
  return rows;
}

function toCellPatch(cell: TableCell): CellPatch {
  switch (cell.kind) {
    case 'number':
      return {
        excelRow: cell.excelRow,
        col: cell.col,
        value: { kind: 'number', value: cell.value },
      };
    case 'text':
      return { excelRow: cell.excelRow, col: cell.col, value: { kind: 'text', value: cell.value } };
    default: {
      const _exhaustive: never = cell.kind;
      throw new Error(`Unhandled cell kind: ${String(_exhaustive)}`);
    }
  }
}

/** What the reader returns for a written cell. */
function writtenValue(cell: TableCell): CellValue {
  switch (cell.kind) {
    case 'number':
      return Number(cell.value);
    case 'text':
      return cell.value;
    default: {
      const _exhaustive: never = cell.kind;
      throw new Error(`Unhandled cell kind: ${String(_exhaustive)}`);
    }
  }
}

/**
 * A deep copy of `source` with every cell of the table written. When a written column
 * lies beyond the source grid's width, every row is first padded with null up to it.
 */
function expectedGrid(source: SheetData, cells: readonly TableCell[]): SheetData {
  const grid = structuredClone(source);
  const sourceWidth = Math.max(0, ...grid.map((row) => row.length));
  const writtenWidth = Math.max(0, ...cells.map((cell) => cell.col + 1));
  if (writtenWidth > sourceWidth) {
    for (const row of grid) {
      while (row.length < writtenWidth) row.push(null);
    }
  }
  for (const cell of cells) {
    const row = grid[cell.excelRow - 1];
    if (row === undefined) throw new Error(`table row ${cell.excelRow} is not in the source grid`);
    row[cell.col] = writtenValue(cell);
  }
  return grid;
}

/**
 * Per written column, how many of the table's cells hold a value the source grid does
 * not hold at that cell. Computed from the source grid and the table only.
 */
function changedCellsByColumn(
  source: SheetData,
  cells: readonly TableCell[],
): ReadonlyMap<number, number> {
  const counts = new Map<number, number>();
  for (const cell of cells) {
    const before = source[cell.excelRow - 1]?.[cell.col] ?? null;
    const changed = before !== writtenValue(cell) ? 1 : 0;
    counts.set(cell.col, (counts.get(cell.col) ?? 0) + changed);
  }
  return counts;
}

function readFixture(file: string): Buffer {
  return readFileSync(new URL(`../../fixtures/${file}`, import.meta.url));
}

describe('new patcher against old patcher on each vertical real cell set', () => {
  for (const vertical of VERTICALS) {
    it(`${vertical.name}: both outputs read back as the source with the table written`, async () => {
      const source = readFixture(vertical.fixture);
      const cells = vertical.cells(dataRows(vertical.lastRow));

      const oldOut = patchXlsxCells(source, toRowPatches(cells));
      const newOut = patchFixture(source, cells.map(toCellPatch), vertical.read);

      const sourceGrid = await readWorkbookGrid(source, vertical.read);
      const oldGrid = await readWorkbookGrid(oldOut, vertical.read);
      const newGrid = await readWorkbookGrid(newOut, vertical.read);

      // The table's data rows are the rows of the sheet the read selected.
      expect(sourceGrid).toHaveLength(vertical.lastRow);
      const expected = expectedGrid(sourceGrid, cells);
      expect(newGrid).toEqual(expected);
      expect(oldGrid).toEqual(expected);

      // No vacuous pass: every column the table writes changes at least one cell.
      for (const [col, changed] of changedCellsByColumn(sourceGrid, cells)) {
        expect(changed, `column ${col}: cells the table changes`).toBeGreaterThan(0);
      }
    });
  }
});
