// The Trendyol flash product format on its own, with no legacy code: the header cases of
// the old resolver's tests, three literal rows of the real file, the keep rule and row
// order, the offer and window cases of the old window-cell and import tests, the
// fallbacks of the row mapper, the permanent golden digests of
// tests/fixtures/workbook-golden/legacy-rows.json (written by the legacy import parser
// before it was deleted), the rows the real file already fills in, and the import
// rehearsal on the real file. A change to `mapRow` or the keep rule that alters any
// field of any row, on the real file or on its derived rows, fails here.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  cellDecimal,
  cellText,
  columnIndex,
  readWorkbookGrid,
  resolveLayout,
  SpreadsheetFileError,
  type CellValue,
  type SheetData,
} from '@pazarsync/spreadsheet';
import { patchFixture } from '@pazarsync/spreadsheet/testing';
import { describe, expect, it, vi } from 'vitest';

import { VALUE_OUT_OF_RANGE_REASON } from '@/workbooks/column-range';
import { FORMAT_SUMMARIES } from '@/workbooks/formats/registry';
import {
  trendyolFlashProductListFormat,
  type FlashProductListRow,
} from '@/workbooks/formats/trendyol/flash-product-list.format';
import {
  FLASH_CUSTOM_PRICE_LABEL,
  TRENDYOL_FINGERPRINTS,
} from '@/workbooks/formats/trendyol/labels';
import { countPrefilled, readRows } from '@/workbooks/import-rows';
import { buildRehearsal, rehearsalTargets } from '@/workbooks/rehearsal';
import { selectFormat } from '@/workbooks/select-format';
import { resolveWriteColumns } from '@/workbooks/write-columns';

import { canonicalJson, sha256Hex } from '../../../helpers/canonical-json';
import { derivedGrid, FLASH_DERIVED } from '../../../helpers/workbook-derived-rows';

// The fixture is read through the parse worker, whose cold start can pass vitest's 5 s
// default under load.
vi.setConfig({ testTimeout: 60_000 });

const FIXTURE_FILE = 'trendyol-flash-products.xlsx';
const FIXTURES_DIR = resolve(__dirname, '../../../fixtures');
const FIXTURE = readFileSync(resolve(FIXTURES_DIR, FIXTURE_FILE));
const GOLDEN_PATH = resolve(FIXTURES_DIR, 'workbook-golden/legacy-rows.json');

const format = trendyolFlashProductListFormat;

// Turkish letters and marks, by code point.
const U_UMLAUT_UPPER = String.fromCodePoint(0x00dc);
const U_UMLAUT = String.fromCodePoint(0x00fc);
const O_UMLAUT = String.fromCodePoint(0x00f6);
const DOTLESS_I = String.fromCodePoint(0x0131);
const S_CEDILLA = String.fromCodePoint(0x015f);
const G_BREVE = String.fromCodePoint(0x011f);
const C_CEDILLA = String.fromCodePoint(0x00e7);
const C_CEDILLA_UPPER = String.fromCodePoint(0x00c7);
const EN_DASH = String.fromCodePoint(0x2013);
const TIMES = String.fromCodePoint(0x00d7);

const URUN = `${U_UMLAUT_UPPER}r${U_UMLAUT}n`;
const FLAS = `Fla${S_CEDILLA}`;
const BASLANGIC = `Ba${S_CEDILLA}lang${DOTLESS_I}${C_CEDILLA} Tarihi`;
const BITIS = `Biti${S_CEDILLA} Tarihi`;
const CUSTOM_PRICE_HEADER = `Senin Belirledi${G_BREVE}in ${FLAS} Fiyat${DOTLESS_I}`;
const TURK_BAYRAGI = `T${U_UMLAUT}rk Bayra${G_BREVE}${DOTLESS_I}`;
const ATATURK = `Atat${U_UMLAUT}rk`;
const RASEL = `Ra${S_CEDILLA}el`;
const KUMAS = `Kuma${S_CEDILLA}`;

// The real Trendyol header, as the legacy resolver's test held it (column index in the
// trailing comment of each line there).
const FULL_HEADER: readonly string[] = [
  'Model Kodu',
  'Barkod',
  `${URUN} Ad${DOTLESS_I}`,
  'Kategori',
  'Marka',
  'Stok',
  'Mevcut Fiyat',
  `M${U_UMLAUT}${S_CEDILLA}terinin G${O_UMLAUT}rd${U_UMLAUT}${G_BREVE}${U_UMLAUT} Fiyat`,
  'Mevcut Komisyon',
  `G${U_UMLAUT}ncellenecek Fiyat`,
  '24 Saat Fiyat',
  '3 Saat Fiyat',
  CUSTOM_PRICE_HEADER,
  `24 Saat ${FLAS} ${BASLANGIC}`,
  `24 Saat ${FLAS} ${BITIS}`,
  `3 Saat ${FLAS} ${BASLANGIC}`,
  `3 Saat ${FLAS} ${BITIS}`,
  `${URUN} Komisyon Tarife Se${C_CEDILLA}ene${G_BREVE}i`,
  `Kampanyal${DOTLESS_I} ${URUN}`,
  `${URUN} Id`,
];

// Column indices of FULL_HEADER.
const COL = {
  modelCode: 0,
  barcode: 1,
  productTitle: 2,
  category: 3,
  brand: 4,
  stock: 5,
  currentPrice: 6,
  customerPrice: 7,
  currentCommission: 8,
  updatedPrice: 9,
  offer24Price: 10,
  offer3Price: 11,
  customFlashPrice: 12,
  offer24Start: 13,
  offer24End: 14,
  offer3Start: 15,
  offer3End: 16,
  commissionTariffFlag: 17,
  campaignedProduct: 18,
  externalId: 19,
} as const;

// The windows of the first real row: 08/07/2026 in Istanbul (UTC+3).
const WINDOW_START_TEXT = '08/07/2026 00:00';
const WINDOW_END_TEXT = '08/07/2026 23:59';
const WINDOW_START = new Date('2026-07-07T21:00:00.000Z');
const WINDOW_END = new Date('2026-07-08T20:59:00.000Z');

// A synthetic data row every literal case starts from: a 24-hour offer with its window.
const BASE_ROW: Readonly<Record<number, CellValue>> = {
  [COL.modelCode]: 'MODEL-1',
  [COL.barcode]: 'BC-1',
  [COL.productTitle]: 'Product',
  [COL.category]: 'Bayrak',
  [COL.brand]: 'Brand',
  [COL.stock]: 18,
  [COL.currentPrice]: 365,
  [COL.customerPrice]: '350',
  [COL.currentCommission]: 19,
  [COL.offer24Price]: 179.47,
  [COL.offer24Start]: WINDOW_START_TEXT,
  [COL.offer24End]: WINDOW_END_TEXT,
  [COL.commissionTariffFlag]: 'Var',
  [COL.campaignedProduct]: '-',
  [COL.externalId]: 'ext-1',
};

/** A data row under `header`: BASE_ROW with `overrides` written over it (null blanks a cell). */
function dataRow(
  overrides: Readonly<Record<number, CellValue>> = {},
  header: readonly string[] = FULL_HEADER,
): CellValue[] {
  return header.map((name) => {
    const col = FULL_HEADER.indexOf(name);
    if (Object.hasOwn(overrides, col)) return overrides[col] ?? null;
    return BASE_ROW[col] ?? null;
  });
}

function present<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`${what} is missing`);
  return value;
}

function headerLayout(header: readonly string[]) {
  return resolveLayout(format.layout, [[...header]]);
}

function gridSelection(grid: SheetData) {
  return { format, grid, layout: present(resolveLayout(format.layout, grid), 'layout') };
}

/** The mapped row of one synthetic data row. */
function mapOne(
  overrides: Readonly<Record<number, CellValue>> = {},
  header: readonly string[] = FULL_HEADER,
): FlashProductListRow {
  const read = readRows(gridSelection([[...header], dataRow(overrides, header)]));
  return present(read.rows[0], 'kept row').data;
}

interface GoldenDigest {
  readonly keptRows: number;
  readonly skippedRows: number;
  readonly sha256: string;
}

function isDigest(value: unknown): value is GoldenDigest {
  return (
    typeof value === 'object' &&
    value !== null &&
    'keptRows' in value &&
    typeof value.keptRows === 'number' &&
    'skippedRows' in value &&
    typeof value.skippedRows === 'number' &&
    'sha256' in value &&
    typeof value.sha256 === 'string'
  );
}

function goldenEntry(file: string): { real: GoldenDigest; derived: GoldenDigest } {
  const golden: unknown = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));
  if (typeof golden !== 'object' || golden === null) throw new Error('golden is not an object');
  const entry: unknown = Reflect.get(golden, file);
  if (typeof entry !== 'object' || entry === null) throw new Error(`no golden entry: ${file}`);
  const real: unknown = Reflect.get(entry, 'real');
  const derived: unknown = Reflect.get(entry, 'derived');
  if (!isDigest(real) || !isDigest(derived)) throw new Error(`bad golden entry: ${file}`);
  return { real, derived };
}

function digest(read: { rows: readonly { data: unknown }[]; skippedRows: number }): GoldenDigest {
  return {
    keptRows: read.rows.length,
    skippedRows: read.skippedRows,
    sha256: sha256Hex(canonicalJson(read.rows.map((r) => r.data))),
  };
}

async function realSelection(file: Buffer = FIXTURE) {
  return selectFormat(file, [format], {
    read: (bytes, sheet) => readWorkbookGrid(bytes, { sheet }),
    summaries: FORMAT_SUMMARIES,
  });
}

function captureThrow(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected the function to throw');
}

describe('Trendyol flash product format: headers', () => {
  it('is the header row of the real fixture', async () => {
    const selection = await realSelection();

    expect(selection.grid[0]).toEqual(FULL_HEADER);
  });

  it('is recognised by its fingerprint headers', () => {
    expect(format.fingerprint).toEqual(TRENDYOL_FINGERPRINTS.FLASH_PRODUCT_LIST);
    for (const name of format.fingerprint) expect(FULL_HEADER).toContain(name);
  });

  it('resolves every column of the real Trendyol header by name', () => {
    const layout = present(headerLayout(FULL_HEADER), 'layout');

    const keys = Object.keys(COL).filter((key): key is keyof typeof COL => Object.hasOwn(COL, key));
    expect(keys).toHaveLength(FULL_HEADER.length);
    for (const key of keys) {
      expect([key, columnIndex(format.layout, layout, key)]).toEqual([key, COL[key]]);
    }
  });

  it('resolves the two write-back columns', () => {
    const layout = present(headerLayout(FULL_HEADER), 'layout');

    expect(resolveWriteColumns(format, layout).map((entry) => [entry.key, entry.col])).toEqual([
      ['updatedPrice', COL.updatedPrice],
      ['customFlashPrice', COL.customFlashPrice],
    ]);
  });

  it('survives a column reorder (header-name resolution)', () => {
    const reversed = [...FULL_HEADER].reverse();
    const layout = present(headerLayout(reversed), 'layout');

    const barcode = present(columnIndex(format.layout, layout, 'barcode'), 'barcode column');
    const custom = present(
      columnIndex(format.layout, layout, 'customFlashPrice'),
      'custom price column',
    );
    expect(reversed[barcode]).toBe('Barkod');
    expect(reversed[custom]).toBe(CUSTOM_PRICE_HEADER);
  });

  it('does not resolve without the barcode column', () => {
    expect(headerLayout(FULL_HEADER.filter((h) => h !== 'Barkod'))).toBeNull();
  });

  it('does not resolve without an offer price column', () => {
    expect(headerLayout(FULL_HEADER.filter((h) => h !== '3 Saat Fiyat'))).toBeNull();
  });

  it('does not resolve a header that is not the flash header', () => {
    expect(headerLayout(['not', 'a', 'flash', 'header'])).toBeNull();
  });
});

describe('Trendyol flash product format: rows of the real file', () => {
  it('maps the first row, a row without a commission tariff and the last row in full', async () => {
    const read = readRows(await realSelection());
    const byRow = new Map(read.rows.map((r) => [r.excelRow, r]));

    expect(byRow.get(2)).toStrictEqual({
      excelRow: 2,
      anchor: 'ATA100X150R',
      data: {
        barcode: 'ATA100X150R',
        modelCode: 'ATA100X150R',
        productTitle: `${ATATURK} Bask${DOTLESS_I}l${DOTLESS_I} ${TURK_BAYRAGI} ${ATATURK} Posteri 100x150 Cm ${RASEL} ${KUMAS} Dijital Bask${DOTLESS_I}`,
        category: 'Bayrak',
        brand: `${RASEL} kuma${S_CEDILLA}`,
        stock: 18,
        currentPrice: '365',
        customerPrice: '365',
        currentCommissionPct: '19',
        hasCommissionTariff: true,
        campaignedProduct: '-',
        offer24: { price: '179.47', startsAt: WINDOW_START, endsAt: WINDOW_END },
        offer3: null,
        externalId: '69b5d10bc8d8fa2528e16fb7141c1609',
      },
    });
    expect(byRow.get(21)).toStrictEqual({
      excelRow: 21,
      anchor: '85697423698',
      data: {
        barcode: '85697423698',
        modelCode: '23645f78988d',
        productTitle: `${TURK_BAYRAGI} 120${TIMES}180 cm (1,2 x 1,8 metre) ${EN_DASH} Canl${DOTLESS_I} ve Parlak ${RASEL} ${KUMAS}, ${C_CEDILLA_UPPER}ift Diki${S_CEDILLA}`,
        category: 'Bayrak',
        brand: 'AKYILDIZ store',
        stock: 13,
        currentPrice: '472.5',
        customerPrice: '448.87',
        currentCommissionPct: '19',
        hasCommissionTariff: false,
        campaignedProduct: '-',
        offer24: { price: '398.37', startsAt: WINDOW_START, endsAt: WINDOW_END },
        offer3: null,
        externalId: '4b8c7e2fafffcfd0f7ac0bb6f9f97052',
      },
    });
    expect(byRow.get(123)).toStrictEqual({
      excelRow: 123,
      anchor: '86962741224212',
      data: {
        barcode: '86962741224212',
        modelCode: 'ATB-50x75-SPL',
        productTitle: `50x75cm Kalpakl${DOTLESS_I} ${ATATURK} ${RASEL} ${KUMAS} Sopal${DOTLESS_I} ${TURK_BAYRAGI} ${EN_DASH} Dayan${DOTLESS_I}kl${DOTLESS_I} ve Kaliteli Dijital Bask${DOTLESS_I}`,
        category: 'Bayrak',
        brand: 'AKYILDIZ store',
        stock: 73,
        currentPrice: '189',
        customerPrice: '179.55',
        currentCommissionPct: '19',
        hasCommissionTariff: true,
        campaignedProduct: '-',
        offer24: {
          price: '139.84',
          startsAt: new Date('2026-07-12T21:00:00.000Z'),
          endsAt: new Date('2026-07-13T20:59:00.000Z'),
        },
        offer3: null,
        externalId: '0f9d58f5494abfd3298fd8baba4a0fe2',
      },
    });
  });

  it('marks the 118 rows whose commission tariff flag is set', async () => {
    const read = readRows(await realSelection());

    expect(read.rows.filter((row) => row.data.hasCommissionTariff)).toHaveLength(118);
  });

  it('finds no row the seller already filled in', async () => {
    const selection = await realSelection();
    const read = readRows(selection);
    const resolved = resolveWriteColumns(format, selection.layout);

    expect(countPrefilled(selection, read.rows, resolved)).toBe(0);
  });
});

describe('Trendyol flash product format: the keep rule and row order', () => {
  it('skips a row without a barcode, a current price or any offer price', () => {
    const grid: SheetData = [
      [...FULL_HEADER],
      dataRow({ [COL.barcode]: null }),
      dataRow({ [COL.barcode]: 'BC-2', [COL.currentPrice]: null }),
      dataRow({ [COL.barcode]: 'BC-3', [COL.offer24Price]: null, [COL.offer3Price]: null }),
      dataRow({ [COL.barcode]: 'BC-4' }),
    ];

    const read = readRows(gridSelection(grid));

    expect(read.rows.map((row) => row.anchor)).toEqual(['BC-4']);
    expect(read.skippedRows).toBe(3);
  });

  it('keeps the sheet order of the rows and every date of one product', () => {
    // Neither ascending nor descending, so an added sort or reverse shows; B-002 repeats
    // with another window, as the real file repeats a product per day.
    const grid: SheetData = [
      [...FULL_HEADER],
      dataRow({ [COL.barcode]: 'B-002' }),
      dataRow({ [COL.barcode]: 'C-003' }),
      dataRow({ [COL.barcode]: 'B-002', [COL.offer24Start]: '09/07/2026 00:00' }),
      dataRow({ [COL.barcode]: 'A-001' }),
    ];

    const read = readRows(gridSelection(grid));

    expect(read.rows.map((row) => row.anchor)).toEqual(['B-002', 'C-003', 'B-002', 'A-001']);
    expect(read.rows.map((row) => row.excelRow)).toEqual([2, 3, 4, 5]);
  });
});

describe('Trendyol flash product format: offers and their windows', () => {
  it('reads a text window as the true Istanbul instant', () => {
    expect(mapOne().offer24).toStrictEqual({
      price: '179.47',
      startsAt: WINDOW_START,
      endsAt: WINDOW_END,
    });
  });

  it('reads a date-typed window cell (the wall clock as UTC) as the same instant as its text', () => {
    const row = mapOne({ [COL.offer24Start]: new Date(Date.UTC(2026, 6, 8, 0, 0)) });

    expect(row.offer24?.startsAt).toStrictEqual(WINDOW_START);
  });

  it.each([
    ['an empty cell', null],
    ['an invalid date', new Date(Number.NaN)],
    ['an unreadable text', 'not a window'],
  ])('reads %s as no window start and keeps the end and the price', (_name, cell) => {
    expect(mapOne({ [COL.offer24Start]: cell }).offer24).toStrictEqual({
      price: '179.47',
      startsAt: null,
      endsAt: WINDOW_END,
    });
  });

  it.each([
    // A date cell (a negative serial, or a t="d" ISO date) holds the wall clock as UTC; a
    // year below 100 or below 1 reads as such.
    ['a date cell in the year 50', COL.offer24Start, new Date('0050-07-08T00:00:00.000Z')],
    ['a date cell before 1 AD', COL.offer24End, new Date('-000001-07-08T00:00:00.000Z')],
    ['a 3-hour window in the year 10000', COL.offer3End, new Date('+010000-07-08T00:00:00.000Z')],
  ])(
    'refuses %s, a date its timestamp column cannot store, with MALFORMED_SHEET value-out-of-range',
    (_name, col, cell) => {
      const err = captureThrow(() => mapOne({ [COL.offer3Price]: 99.9, [col]: cell }));

      expect(err).toBeInstanceOf(SpreadsheetFileError);
      if (!(err instanceof SpreadsheetFileError)) return;
      expect(err.code).toBe('MALFORMED_SHEET');
      expect(err.meta).toEqual({ reason: VALUE_OUT_OF_RANGE_REASON });
    },
  );

  it('reads no window when the sheet has no window columns', () => {
    const header = FULL_HEADER.filter((_, col) => col < COL.offer24Start || col > COL.offer3End);

    expect(mapOne({}, header).offer24).toStrictEqual({
      price: '179.47',
      startsAt: null,
      endsAt: null,
    });
  });

  it('makes no offer from a window without a price', () => {
    const row = mapOne({
      [COL.offer3Start]: '08/07/2026 09:00',
      [COL.offer3End]: '08/07/2026 12:00',
    });

    expect(row.offer3).toBeNull();
  });

  it('reads both offers of one row, each with its own window', () => {
    const row = mapOne({
      [COL.offer3Price]: 99.9,
      [COL.offer3Start]: '08/07/2026 09:00',
      [COL.offer3End]: '08/07/2026 12:00',
    });

    expect(row.offer24?.price).toBe('179.47');
    expect(row.offer3).toStrictEqual({
      price: '99.9',
      startsAt: new Date('2026-07-08T06:00:00.000Z'),
      endsAt: new Date('2026-07-08T09:00:00.000Z'),
    });
  });

  it('keeps a row with a 3-hour offer only', () => {
    const row = mapOne({ [COL.offer24Price]: null, [COL.offer3Price]: 149.9 });

    expect(row.offer24).toBeNull();
    expect(row.offer3?.price).toBe('149.9');
  });

  it('reads an offer price with the plain grammar: a decimal comma reads, a lira suffix does not', () => {
    expect(mapOne({ [COL.offer24Price]: '179,47' }).offer24?.price).toBe('179.47');
    expect(mapOne({ [COL.offer24Price]: '179 TL', [COL.offer3Price]: 99.9 }).offer24).toBeNull();
  });
});

describe('Trendyol flash product format: the row fallbacks', () => {
  it('falls back to the current price for a blank customer price', () => {
    expect(mapOne({ [COL.customerPrice]: null }).customerPrice).toBe('365');
    expect(mapOne().customerPrice).toBe('350');
  });

  it("falls back to '0' for a blank current commission", () => {
    expect(mapOne({ [COL.currentCommission]: null }).currentCommissionPct).toBe('0');
    expect(mapOne().currentCommissionPct).toBe('19');
  });

  it.each([
    ['VAR', true],
    ['var', true],
    ['Var', true],
    ['Yok', false],
    ['-', false],
    [null, false],
  ])('reads the tariff flag %s as %s (Turkish case folding)', (flag, expected) => {
    expect(mapOne({ [COL.commissionTariffFlag]: flag }).hasCommissionTariff).toBe(expected);
  });

  it.each([
    ['the number 12.7', 12, 12.7],
    ['the text 12.7', 12, '12.7'],
    ['a non-numeric text', null, 'many'],
    ['a blank cell', null, null],
  ])('reads a stock of %s as %s (truncated)', (_name, expected, cell) => {
    expect(mapOne({ [COL.stock]: cell }).stock).toBe(expected);
  });

  it('refuses a stock of 1e20, past its integer column, with MALFORMED_SHEET value-out-of-range', () => {
    const err = captureThrow(() => mapOne({ [COL.stock]: 1e20 }));

    expect(err).toBeInstanceOf(SpreadsheetFileError);
    if (!(err instanceof SpreadsheetFileError)) return;
    expect(err.code).toBe('MALFORMED_SHEET');
    expect(err.meta).toEqual({ reason: VALUE_OUT_OF_RANGE_REASON });
  });

  it('falls back to the barcode for a blank title and reads blank optional columns as null', () => {
    const row = mapOne({
      [COL.productTitle]: null,
      [COL.modelCode]: null,
      [COL.category]: null,
      [COL.brand]: null,
      [COL.campaignedProduct]: null,
      [COL.externalId]: null,
    });

    expect(row).toMatchObject({
      productTitle: 'BC-1',
      modelCode: null,
      category: null,
      brand: null,
      campaignedProduct: null,
      externalId: null,
    });
  });
});

describe('Trendyol flash product format: the import rehearsal on the real file', () => {
  it('writes the longest label and a 10-digit price into every kept row and passes', async () => {
    const selection = await realSelection();
    const read = readRows(selection);
    const resolved = resolveWriteColumns(format, selection.layout);
    const rehearsal = buildRehearsal(selection, rehearsalTargets('cursor-zip', read), resolved);

    expect(rehearsal.patches).toHaveLength(read.rows.length * 2);
    expect(new Set(rehearsal.patches.map((patch) => JSON.stringify(patch.value)))).toEqual(
      new Set([
        JSON.stringify({ kind: 'text', value: FLASH_CUSTOM_PRICE_LABEL }),
        JSON.stringify({ kind: 'number', value: '9999999999.99', scale: 2 }),
      ]),
    );

    const patched = patchFixture(FIXTURE, rehearsal.patches, {
      sheet: format.sheet,
      overwriteFormulaColumns: rehearsal.overwriteFormulaColumns,
    });
    const grid = await readWorkbookGrid(patched, { sheet: format.sheet });
    for (const row of read.rows) {
      const cells = grid[row.excelRow - 1] ?? [];
      expect(cellText(cells, COL.updatedPrice)).toBe(FLASH_CUSTOM_PRICE_LABEL);
      expect(cellDecimal(cells, COL.customFlashPrice, 'plain')).toBe('9999999999.99');
    }
  });
});

describe('Trendyol flash product format: the legacy golden digests', () => {
  it("reads the real file to the legacy parser's digest", async () => {
    const read = readRows(await realSelection());

    expect(digest(read)).toEqual(goldenEntry(FIXTURE_FILE).real);
    expect(read.rows.length).toBe(122);
    expect(read.skippedRows).toBe(0);
  });

  it("reads the derived rows to the legacy parser's digest, dropped and kept rows included", async () => {
    const fixture = (await realSelection()).grid;
    const grid = derivedGrid(format.layout, format.keep, fixture, FLASH_DERIVED);
    const read = readRows(gridSelection(grid));
    const { real, derived } = goldenEntry(FIXTURE_FILE);
    const keptCases = FLASH_DERIVED.filter((testCase) => testCase.kept).length;

    expect(digest(read)).toEqual(derived);
    // Every derived case lands on the side its `kept` flag names.
    expect(read.rows.length).toBe(real.keptRows + keptCases);
    expect(read.skippedRows).toBe(real.skippedRows + FLASH_DERIVED.length - keptCases);
    // The derived grid both drops and keeps rows, so its digest pins a row mapping and
    // not only a skipped count.
    expect(read.skippedRows).toBe(3);
    expect(read.rows.length).toBe(138);
    expect(derived.skippedRows).toBeGreaterThan(0);
    expect(derived.keptRows).toBeGreaterThan(real.keptRows);
    expect(derived.sha256).not.toBe(real.sha256);
  });
});
