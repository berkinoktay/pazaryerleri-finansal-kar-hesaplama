import { describe, expect, it, vi } from 'vitest';

import { Platform } from '@pazarsync/db/enums';
import {
  defineLayout,
  has,
  header,
  resolveLayout,
  SpreadsheetFileError,
  type CellValue,
  type SheetData,
} from '@pazarsync/spreadsheet';
import { WORKBOOK_PAGES } from '@pazarsync/utils';

import { IMPORT_INSERT_CHUNK_ROWS, UPLOAD_NAME_MAX_LENGTH } from '@/config/workbook-limits';
import { ValidationError } from '@/lib/errors';
import { defineFormat } from '@/workbooks/format';
import { countPrefilled, createManyChunked, deriveName, readRows } from '@/workbooks/import-rows';
import { resolveWriteColumns } from '@/workbooks/write-columns';
import {
  toUploadError,
  WorkbookFileRejection,
  WorkbookInvariantError,
} from '@/workbooks/workbook-errors';

// A synthetic discount-page format: a barcode anchor, a price the keep rule needs, and
// one write column of each value kind, the last one seeded from the source file.

const HEADER = ['Barcode', 'Price', 'Selection', 'Label', 'Code', 'Included'] as const;

const layout = defineLayout({
  headerLookahead: 0,
  required: { barcode: header('Barcode'), price: header('Price') },
  optional: {
    selection: header('Selection'),
    label: header('Label'),
    code: header('Code'),
    included: header('Included'),
  },
  blocks: {},
});

function syntheticFormat(keepNeedsBarcode: boolean) {
  return defineFormat({
    id: 'TRENDYOL:DISCOUNT_LIST:v1',
    platform: Platform.TRENDYOL,
    page: WORKBOOK_PAGES.DISCOUNT_LIST,
    sheet: { by: 'name', name: 'Products' },
    layout,
    keep: keepNeedsBarcode ? has('barcode', 'text') : has('price', 'decimal'),
    anchor: 'barcode',
    fingerprint: ['Barcode', 'Price', 'Selection'],
    mapRow: (reader, anchor) => ({ barcode: anchor, price: reader.decimal('price') }),
    writeBack: {
      selection: {
        target: { kind: 'column', key: 'selection' },
        value: { kind: 'number', scale: 2 },
        overwritesFormula: true,
        seededFromSource: false,
        clearWhenUnselected: false,
      },
      label: {
        target: { kind: 'column', key: 'label' },
        value: { kind: 'text', allow: ['Yes', 'No'] },
        overwritesFormula: true,
        seededFromSource: false,
        clearWhenUnselected: false,
      },
      code: {
        target: { kind: 'column', key: 'code' },
        value: { kind: 'text', pattern: /^\d+ days$/, probe: '9999 days' },
        overwritesFormula: true,
        seededFromSource: false,
        clearWhenUnselected: false,
      },
      included: {
        target: { kind: 'column', key: 'included' },
        value: { kind: 'text', allow: ['Y', 'N'] },
        overwritesFormula: true,
        seededFromSource: true,
        clearWhenUnselected: false,
      },
    },
    exportRequires: [['selection']],
    prefilled: 'ignore',
    defaultName: 'Synthetic list',
    filename: { kind: 'fixed', base: 'synthetic' },
  });
}

const FORMAT = syntheticFormat(true);

function row(barcode: CellValue, price: CellValue, writes: readonly CellValue[] = []): CellValue[] {
  return [barcode, price, ...writes];
}

function selected(grid: SheetData, format = FORMAT) {
  const resolved = resolveLayout(format.layout, grid);
  if (resolved === null) throw new Error('synthetic layout did not resolve');
  return { format, grid, layout: resolved };
}

function captureThrow(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected the function to throw');
}

describe('readRows', () => {
  it('counts kept and skipped rows, and numbers each kept row by its sheet row', () => {
    const grid: SheetData = [
      [...HEADER],
      row('B-1', 10),
      row(null, 11),
      row('B-3', 12),
      row('B-4', 13),
    ];
    const read = readRows(selected(grid));

    expect(read.rows).toHaveLength(3);
    expect(read.skippedRows).toBe(1);
    // The third kept row, after one skipped row: grid index 4, sheet row 5.
    expect(read.rows[2]).toEqual({
      excelRow: 5,
      anchor: 'B-4',
      data: { barcode: 'B-4', price: '13' },
    });
  });

  it('gives a reader over the first data row, kept or not', () => {
    const grid: SheetData = [[...HEADER], row(null, 7), row('B-2', 8)];
    const read = readRows(selected(grid));

    expect(read.firstDataRow?.decimal('price')).toBe('7');
  });

  it('throws WorkbookInvariantError for a kept row without an anchor', () => {
    const format = syntheticFormat(false);
    const grid: SheetData = [[...HEADER], row('B-1', 10), row(null, 11)];

    expect(() => readRows(selected(grid, format))).toThrow(WorkbookInvariantError);
  });

  it('refuses an anchor longer than 256 characters as MALFORMED_SHEET, a 422 on upload', () => {
    const grid: SheetData = [[...HEADER], row('B-1', 10), row('x'.repeat(257), 11)];

    const err = captureThrow(() => readRows(selected(grid)));
    expect(err).toBeInstanceOf(SpreadsheetFileError);
    expect(err instanceof SpreadsheetFileError ? err.code : null).toBe('MALFORMED_SHEET');

    const mapped = captureThrow(() =>
      toUploadError(err, {}, { page: WORKBOOK_PAGES.DISCOUNT_LIST }),
    );
    expect(mapped).toBeInstanceOf(ValidationError);
    expect(mapped instanceof ValidationError ? mapped.issues : null).toEqual([
      { field: 'file', code: 'MALFORMED_SHEET' },
    ]);
  });

  it('accepts an anchor of exactly 256 characters', () => {
    const anchor = 'x'.repeat(256);
    const grid: SheetData = [[...HEADER], row(anchor, 10)];

    expect(readRows(selected(grid)).rows[0]?.anchor).toBe(anchor);
  });

  it('lists every row whose anchor has text, kept or not, as an anchored row', () => {
    const format = syntheticFormat(false);
    // Sheet row 3 has a barcode but no price: dropped by the keep rule, still anchored.
    const grid: SheetData = [[...HEADER], row('B-1', 10), row('B-2', null), row('B-3', 12)];
    const read = readRows(selected(grid, format));

    expect(read.rows.map((r) => r.excelRow)).toEqual([2, 4]);
    expect(read.anchoredRows).toEqual([
      { excelRow: 2, anchor: 'B-1' },
      { excelRow: 3, anchor: 'B-2' },
      { excelRow: 4, anchor: 'B-3' },
    ]);
  });

  it('does not list a row with an empty anchor cell as anchored', () => {
    const grid: SheetData = [[...HEADER], row('B-1', 10), row('  ', 11)];
    const read = readRows(selected(grid));

    expect(read.anchoredRows).toEqual([{ excelRow: 2, anchor: 'B-1' }]);
    expect(read.skippedRows).toBe(1);
  });

  it('rejects a sheet with no kept row as EMPTY_FILE', () => {
    const grid: SheetData = [[...HEADER], row(null, 10)];

    const err = captureThrow(() => readRows(selected(grid)));
    expect(err).toBeInstanceOf(WorkbookFileRejection);
    expect(err instanceof WorkbookFileRejection ? err.code : null).toBe('EMPTY_FILE');
  });
});

describe('countPrefilled', () => {
  function prefilled(writes: readonly CellValue[]): number {
    const grid: SheetData = [[...HEADER], row('B-1', 10, writes)];
    const sel = selected(grid);
    const read = readRows(sel);
    return countPrefilled(sel, read.rows, resolveWriteColumns(sel.format, sel.layout));
  }

  it('counts an allow-list member', () => {
    expect(prefilled([null, 'Yes'])).toBe(1);
  });

  it('counts a value matching the pattern', () => {
    expect(prefilled([null, null, '7 days'])).toBe(1);
  });

  it('does not count text outside the allow list or the pattern', () => {
    expect(prefilled([null, 'Maybe', '7 weeks'])).toBe(0);
  });

  it('counts a positive number', () => {
    expect(prefilled([15.4])).toBe(1);
  });

  it('does not count 0 or an empty string', () => {
    expect(prefilled([0])).toBe(0);
    expect(prefilled([''])).toBe(0);
    expect(prefilled(['0'])).toBe(0);
  });

  it('never counts a column seeded from the source file', () => {
    expect(prefilled([null, null, null, 'Y'])).toBe(0);
  });

  it('counts a row with two prefilled columns once', () => {
    expect(prefilled([12, 'No'])).toBe(1);
  });

  it('counts each prefilled row', () => {
    const grid: SheetData = [
      [...HEADER],
      row('B-1', 10, [5]),
      row('B-2', 10),
      row('B-3', 10, [null, 'Yes']),
    ];
    const sel = selected(grid);
    const read = readRows(sel);

    expect(countPrefilled(sel, read.rows, resolveWriteColumns(sel.format, sel.layout))).toBe(2);
  });
});

describe('deriveName', () => {
  const RLO = String.fromCodePoint(0x202e);
  const BEL = String.fromCodePoint(0x0007);
  // U+1F4E6, a code point outside the BMP: one code point, two UTF-16 units.
  const ASTRAL = String.fromCodePoint(0x1f4e6);
  const base = { name: undefined, sourceFilename: null, fallback: null, defaultName: 'Default' };

  it('takes the typed name first', () => {
    expect(
      deriveName({ ...base, name: ' Typed ', sourceFilename: 'file.xlsx', fallback: 'From file' }),
    ).toBe('Typed');
  });

  it('takes the stem of the sanitized file name next', () => {
    expect(deriveName({ ...base, name: '  ', sourceFilename: 'file.XLSX', fallback: 'x' })).toBe(
      'file',
    );
  });

  it("takes the adapter's fallback next", () => {
    expect(deriveName({ ...base, fallback: 'From file' })).toBe('From file');
  });

  it('takes the default name last', () => {
    expect(deriveName(base)).toBe('Default');
  });

  it('cuts a 200-character name to 120', () => {
    const name = deriveName({ ...base, name: 'n'.repeat(200) });

    expect(name).toHaveLength(UPLOAD_NAME_MAX_LENGTH);
  });

  it('drops a bidi override and a control character from the fallback', () => {
    expect(deriveName({ ...base, fallback: `a${RLO}b${BEL}c` })).toBe('abc');
  });

  it('falls through to the default name when the fallback is only control characters', () => {
    expect(deriveName({ ...base, fallback: `${RLO}${BEL}` })).toBe('Default');
  });

  it('cuts 200 astral characters to 120 code points, never inside a pair', () => {
    const name = deriveName({ ...base, name: ASTRAL.repeat(200) });

    // Every code point is the whole astral character: no pair was split.
    expect(Array.from(name)).toEqual(Array.from({ length: UPLOAD_NAME_MAX_LENGTH }, () => ASTRAL));
  });
});

describe('createManyChunked', () => {
  it('inserts in chunks of IMPORT_INSERT_CHUNK_ROWS, in order', async () => {
    const items = Array.from({ length: IMPORT_INSERT_CHUNK_ROWS * 2 + 1 }, (_, i) => i);
    const insert = vi.fn(async (_chunk: number[]) => undefined);

    await createManyChunked(items, insert);

    expect(insert.mock.calls.map(([chunk]) => chunk.length)).toEqual([
      IMPORT_INSERT_CHUNK_ROWS,
      IMPORT_INSERT_CHUNK_ROWS,
      1,
    ]);
    expect(insert.mock.calls.flatMap(([chunk]) => chunk)).toEqual(items);
  });

  it('inserts nothing for no items', async () => {
    const insert = vi.fn(async (_chunk: number[]) => undefined);

    await createManyChunked([], insert);

    expect(insert).not.toHaveBeenCalled();
  });
});
