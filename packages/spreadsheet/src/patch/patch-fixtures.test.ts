import { describe, expect, it } from 'vitest';

import { FIXTURE_PINS, readFixture, type FixturePin } from '../../tests/helpers/fixture-pins';
import { num, text } from '../../tests/helpers/patch-helpers';
import { SpreadsheetFileError } from '../errors';
import type { CellValue, SheetData } from '../grid-types';
import { openUpload } from '../guards';
import { readSheet, readUploadGrid } from '../read-grid';
import { resolveReadOptions } from '../read-options';
import { patchFixture } from '../testing/patch-fixture';
import type { CellPatch } from './patch-request';
import { entryContent, readZipLayout, type ZipEntry, type ZipLayout } from './raw-zip';
import { MALFORMED_SHEET_REASONS } from './reasons';

// The eight real exports, every data row patched in the columns each vertical writes:
// the output reads back to the expected grid, every other entry is copied as raw
// bytes, and the sheet keeps its bytes before the first data row and from the end of
// its sheet data.

/** What one fixture's patch writes, and the start tags its output sheet must hold. */
interface FixturePatchPlan {
  /** 0-based columns written as numbers. */
  readonly numberColumns: readonly number[];
  /** 0-based columns written as text. */
  readonly textColumns: readonly number[];
  /** 0-based columns whose formula cells may be overwritten. */
  readonly flagged: readonly number[];
  readonly startTags: readonly string[];
}

const NOTHING: readonly number[] = [];
// A non-ASCII letter in every text value (U+00FC), so the written text is multi-byte UTF-8.
const NON_ASCII_LETTER = String.fromCharCode(0xfc);
const FIRST_DATA_ROW = 2;
const COLUMN_DIGITS = 2;
const FIRST_DATA_ROW_TAG = '<row r="2"';
const SHEET_DATA_END_TAG = '</sheetData>';
const decoder = new TextDecoder();

const PLANS: Readonly<Record<string, FixturePatchPlan>> = {
  'trendyol-commission-tariff.xlsx': {
    numberColumns: [27],
    textColumns: [30],
    flagged: NOTHING,
    startTags: ['<c r="AB2" s="126"><v>2.27</v></c>', '<c r="AE2" s="132" t="inlineStr"><is><t>'],
  },
  'trendyol-tariff-1period.xlsx': {
    numberColumns: [22],
    textColumns: [24],
    flagged: NOTHING,
    startTags: [
      '<c r="W2"><v>2.22</v></c>',
      '<c r="W3"><v>3.22</v></c><c r="X3"',
      '</v></c><c r="Y3" t="inlineStr"><is><t>',
    ],
  },
  'trendyol-plus-tariff.xlsx': {
    numberColumns: [16, 18],
    textColumns: [17, 19],
    flagged: [17, 18, 19],
    startTags: [
      '<c r="Q2" s="39"><v>2.16</v></c>',
      '<c r="R2" s="40" t="inlineStr">',
      '<c r="S2" s="41"><v>2.18</v></c>',
      '<c r="T2" s="42" t="inlineStr">',
    ],
  },
  'trendyol-plus-tariff-3ve4.xlsx': {
    numberColumns: [18, 21, 22],
    textColumns: [19, 23],
    flagged: [21, 22, 23],
    startTags: [
      '<c r="S2" s="50"><v>2.18</v></c>',
      '<c r="T2" s="51" t="inlineStr">',
      '<c r="V2" s="53"><v>2.21</v></c>',
      '<c r="W2" s="54"><v>2.22</v></c>',
      '<c r="X2" s="55" t="inlineStr">',
    ],
  },
  'trendyol-discount-products.xlsx': {
    numberColumns: NOTHING,
    textColumns: [8],
    flagged: NOTHING,
    startTags: ['<c r="I2" t="inlineStr"><is><t>'],
  },
  'trendyol-flash-products.xlsx': {
    numberColumns: [12],
    textColumns: [9],
    flagged: NOTHING,
    startTags: ['<c r="J2" s="30" t="inlineStr">', '<c r="M2" s="33"><v>2.12</v></c>'],
  },
  'trendyol-advantage-tariff.xlsx': {
    numberColumns: [15],
    textColumns: NOTHING,
    flagged: NOTHING,
    startTags: ['<c r="P2" s="70"><v>2.15</v></c>'],
  },
  'marketplace-campaign-sample.xlsx': {
    numberColumns: [11],
    textColumns: NOTHING,
    flagged: NOTHING,
    startTags: ['<c r="L2" s="4"><v>2.11</v></c>'],
  },
};

// The Plus fixtures with no column flagged: patches on formula cells, and the rows.
const FORMULA_POLICY: readonly (readonly [file: string, count: number])[] = [
  ['trendyol-plus-tariff.xlsx', 165],
  ['trendyol-plus-tariff-3ve4.xlsx', 99],
];
const FORMULA_POLICY_ROWS: readonly number[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

function planOf(pin: FixturePin): FixturePatchPlan {
  const plan = PLANS[pin.file];
  if (plan === undefined) throw new Error(`no patch plan for ${pin.file}`);
  return plan;
}

function pinOf(file: string): FixturePin {
  const pin = FIXTURE_PINS.find((candidate) => candidate.file === file);
  if (pin === undefined) throw new Error(`no fixture pin for ${file}`);
  return pin;
}

function numberValue(excelRow: number, col: number): string {
  return `${excelRow}.${String(col).padStart(COLUMN_DIGITS, '0')}`;
}

function textValue(excelRow: number, col: number): string {
  return `T${excelRow}-${col} ${NON_ASCII_LETTER}`;
}

/** Every data row of the fixture, in the plan's number and text columns. */
function patchesOf(pin: FixturePin, plan: FixturePatchPlan): CellPatch[] {
  const patches: CellPatch[] = [];
  for (let excelRow = FIRST_DATA_ROW; excelRow <= pin.rows; excelRow += 1) {
    for (const col of plan.numberColumns)
      patches.push(num(excelRow, col, numberValue(excelRow, col)));
    for (const col of plan.textColumns) patches.push(text(excelRow, col, textValue(excelRow, col)));
  }
  return patches;
}

/** What a patched cell reads back as. */
function readValue(patch: CellPatch): CellValue {
  switch (patch.value.kind) {
    case 'number':
      return Number(patch.value.value);
    case 'text':
      return patch.value.value;
    case 'clear':
      return null;
    default: {
      const _exhaustive: never = patch.value;
      throw new Error(`Unhandled cell value kind: ${String(_exhaustive)}`);
    }
  }
}

function expectedGrid(source: SheetData, patches: readonly CellPatch[]): SheetData {
  const grid = source.map((row) => [...row]);
  for (const patch of patches) {
    const row = grid[patch.excelRow - 1];
    if (row === undefined) throw new Error(`the source grid has no row ${patch.excelRow}`);
    row[patch.col] = readValue(patch);
  }
  return grid;
}

function differingCells(a: SheetData, b: SheetData): number {
  let count = 0;
  a.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell !== b[r]?.[c]) count += 1;
    });
  });
  return count;
}

function entryNamed(layout: ZipLayout, name: string): ZipEntry {
  const entry = layout.entries.find((candidate) => candidate.name === name);
  if (entry === undefined) throw new Error(`no entry named ${name}`);
  return entry;
}

function rawSegment(file: Uint8Array, entry: ZipEntry): Buffer {
  return Buffer.from(
    file.buffer,
    file.byteOffset + entry.headerOffset,
    entry.segmentEnd - entry.headerOffset,
  );
}

function fileErrorOf(run: () => unknown): SpreadsheetFileError {
  try {
    run();
  } catch (error) {
    if (error instanceof SpreadsheetFileError) return error;
    throw error;
  }
  throw new Error('Expected a SpreadsheetFileError');
}

describe.each(FIXTURE_PINS)('patchFixture on $file', (pin) => {
  const plan = planOf(pin);
  const read = resolveReadOptions({ sheetName: pin.sheetName });
  const source = readFixture(pin.file);
  const patches = patchesOf(pin, plan);
  let patched: Buffer | undefined;
  let sheetPart: string | undefined;

  // Built on first use, so a failing patch fails the test that asked, not the collection.
  function output(): Buffer {
    patched ??= patchFixture(source, patches, {
      sheetName: pin.sheetName,
      overwriteFormulaColumns: plan.flagged,
    });
    return patched;
  }

  /** The worksheet part the reader converts. */
  function partPath(): string {
    sheetPart ??= readSheet(
      openUpload(source, { rowCap: read.rowCap, colCap: read.colCap, maxBytes: read.maxBytes }),
      { sheetName: read.sheetName, caps: { rowCap: read.rowCap, colCap: read.colCap } },
    ).partPath;
    return sheetPart;
  }

  it('reads back to the source grid with every patched cell written', () => {
    const sourceGrid = readUploadGrid(source, read);
    const expected = expectedGrid(sourceGrid, patches);
    expect(differingCells(expected, sourceGrid)).toBe(patches.length);
    expect(readUploadGrid(output(), read)).toEqual(expected);
  });

  it('copies every other entry as raw bytes', () => {
    const before = readZipLayout(source);
    const out = output();
    const after = readZipLayout(out);
    expect(after.entries.map((entry) => entry.name)).toEqual(
      before.entries.map((entry) => entry.name),
    );
    for (const entry of before.entries) {
      if (entry.name === partPath()) continue;
      expect(rawSegment(out, entryNamed(after, entry.name)).equals(rawSegment(source, entry))).toBe(
        true,
      );
    }
  });

  it('writes the cells into the sheet and keeps its bytes around the data rows', () => {
    const out = output();
    const sourceSheet = decoder.decode(
      entryContent(source, entryNamed(readZipLayout(source), partPath())),
    );
    const outSheet = decoder.decode(entryContent(out, entryNamed(readZipLayout(out), partPath())));
    for (const tag of plan.startTags) expect(outSheet).toContain(tag);
    const firstDataRow = sourceSheet.indexOf(FIRST_DATA_ROW_TAG);
    const sheetDataEnd = sourceSheet.indexOf(SHEET_DATA_END_TAG);
    expect(firstDataRow).toBeGreaterThan(0);
    expect(sheetDataEnd).toBeGreaterThan(firstDataRow);
    expect(outSheet.startsWith(sourceSheet.slice(0, firstDataRow))).toBe(true);
    expect(outSheet.endsWith(sourceSheet.slice(sheetDataEnd))).toBe(true);
  });

  it('returns the source itself for no patches', () => {
    expect(patchFixture(source, [])).toBe(source);
  });
});

describe('patchFixture: the formula policy on the Plus fixtures', () => {
  it.each(FORMULA_POLICY)('%s refuses formula targets in columns not flagged', (file, count) => {
    const pin = pinOf(file);
    const error = fileErrorOf(() =>
      patchFixture(readFixture(file), patchesOf(pin, planOf(pin)), {
        sheetName: pin.sheetName,
        overwriteFormulaColumns: NOTHING,
      }),
    );
    expect(error.code).toBe('MALFORMED_SHEET');
    expect(error.meta).toEqual({
      reason: MALFORMED_SHEET_REASONS.FORMULA_TARGET,
      count,
      rows: FORMULA_POLICY_ROWS,
    });
  });
});
