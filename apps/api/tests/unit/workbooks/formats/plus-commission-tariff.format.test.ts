// The Trendyol Plus commission tariff format on its own, with no legacy code: the header
// cases of the old resolver's test and of the Plus block of the layout parity test, the
// write columns of both real files and the formula columns the export may overwrite,
// literal rows of the real files, the three fallback chains and the cancel cell, the
// unknown (null) prices and percents, a Plus price ceiling or period offer the export
// could not write, the permanent golden digests
// of tests/fixtures/workbook-golden/legacy-rows.json (written by the legacy import
// parser before it was deleted), the rows the real files already fill in, and the import
// rehearsal on both real files. A change to `mapRow` or the keep rule that alters any
// field of any row, on the real files or on the derived rows, fails here.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  columnIndex,
  createRowReader,
  MALFORMED_SHEET_REASONS,
  readWorkbookGrid,
  resolveLayout,
  SpreadsheetFileError,
  type CellValue,
  type ColumnKey,
  type ResolvedLayout,
  type SheetData,
} from '@pazarsync/spreadsheet';
import { patchFixture } from '@pazarsync/spreadsheet/testing';
import { businessZoneEpochToInstant } from '@pazarsync/utils';
import { describe, expect, it, vi } from 'vitest';

import { VALUE_OUT_OF_RANGE_REASON } from '@/workbooks/column-range';
import { FORMAT_SUMMARIES } from '@/workbooks/formats/registry';
import {
  NO_LABEL,
  TARIFF_WINDOW_LABEL_UNIT,
  TRENDYOL_FINGERPRINTS,
} from '@/workbooks/formats/trendyol/labels';
import {
  trendyolPlusCommissionTariffFormat,
  type PlusCommissionTariffRow,
} from '@/workbooks/formats/trendyol/plus-commission-tariff.format';
import { countPrefilled, readRows } from '@/workbooks/import-rows';
import { buildRehearsal, rehearsalTargets } from '@/workbooks/rehearsal';
import { selectFormat } from '@/workbooks/select-format';
import {
  overwriteFormulaColumns,
  probeText,
  resolveWriteColumns,
  UNWRITABLE_VALUE_REASON,
} from '@/workbooks/write-columns';

import { canonicalJson, sha256Hex } from '../../../helpers/canonical-json';
import {
  derivedGrid,
  PLUS_CANCEL_NUMBER_ONE,
  PLUS_CANCEL_TEXT_ZERO,
  PLUS_DERIVED,
} from '../../../helpers/workbook-derived-rows';

// The fixtures are read through the parse worker, whose cold start can pass vitest's 5 s
// default under load.
vi.setConfig({ testTimeout: 60_000 });

const SINGLE_FILE = 'trendyol-plus-tariff.xlsx';
const MULTI_FILE = 'trendyol-plus-tariff-3ve4.xlsx';
const FIXTURES_DIR = resolve(__dirname, '../../../fixtures');
const SINGLE = readFileSync(resolve(FIXTURES_DIR, SINGLE_FILE));
const MULTI = readFileSync(resolve(FIXTURES_DIR, MULTI_FILE));
const GOLDEN_PATH = resolve(FIXTURES_DIR, 'workbook-golden/legacy-rows.json');
const READER_OPTIONS = { toInstant: businessZoneEpochToInstant };

const format = trendyolPlusCommissionTariffFormat;

type PlusColumn = ColumnKey<typeof format.layout>;

// Turkish letters and signs, by code point.
const U_UMLAUT_UPPER = String.fromCodePoint(0x00dc);
const U_UMLAUT = String.fromCodePoint(0x00fc);
const I_DOTTED_UPPER = String.fromCodePoint(0x0130);
const DOTLESS_I = String.fromCodePoint(0x0131);
const G_BREVE = String.fromCodePoint(0x011f);
const S_CEDILLA = String.fromCodePoint(0x015f);
const C_CEDILLA = String.fromCodePoint(0x00e7);
const C_CEDILLA_UPPER = String.fromCodePoint(0x00c7);
const TIMES = String.fromCodePoint(0x00d7);
const EN_DASH = String.fromCodePoint(0x2013);

const ARALIGI = `Aral${DOTLESS_I}${G_BREVE}${DOTLESS_I}`;
const GUN = `G${U_UMLAUT}n`;
const TURK_BAYRAGI = `T${U_UMLAUT}rk Bayra${G_BREVE}${DOTLESS_I}`;
const KUMAS = `Kuma${S_CEDILLA}`;
const RASEL = `Ra${S_CEDILLA}el`;
const CIFT_DIKIS = `${C_CEDILLA_UPPER}ift Diki${S_CEDILLA}`;

const BARKOD = 'Barkod';
const OFFER_HEADER = 'Plus Komisyon Teklifi';
const PRICE_UPPER_HEADER = `Plus Fiyat ${U_UMLAUT_UPPER}st Limiti`;

function periodHeader(days: number): string {
  return `Tarih ${ARALIGI} (${days} ${GUN})`;
}

function computedHeader(days: number): string {
  return `Hesaplanan Komisyon (${days} ${GUN})`;
}

// The real single-period (7-day) Plus header, as the legacy resolver's test held it.
const PLUS_HEADER: readonly string[] = [
  `${U_UMLAUT_UPPER}r${U_UMLAUT}n ${I_DOTTED_UPPER}smi`,
  `${U_UMLAUT_UPPER}r${U_UMLAUT}n Id`,
  BARKOD,
  `Sat${DOTLESS_I}c${DOTLESS_I} Stok Kodu`,
  'Beden',
  'Model Kodu',
  'Kategori',
  'Marka',
  'Stok',
  `G${U_UMLAUT}ncel TSF`,
  'Komisyona Esas Fiyat',
  `G${U_UMLAUT}ncel Komisyon`,
  PRICE_UPPER_HEADER,
  periodHeader(7),
  OFFER_HEADER,
  `Plus Komisyona Esas Fiyat${DOTLESS_I}`,
  `Plus Fiyat Se${C_CEDILLA}imi`,
  `Tarife Se${C_CEDILLA}imi`,
  computedHeader(7),
  `${I_DOTTED_UPPER}ptal`,
  'External Id',
  'Tarife Grubu',
];

// The real two-period (3 + 4 day) Plus header: each period label is followed by its own
// offer column; the trailing "N Gun Tarih Araligi" and "External Id (N Gun)" columns are
// decoys that must not open a period.
const PLUS_HEADER_MULTI: readonly string[] = [
  ...PLUS_HEADER.slice(0, 13),
  periodHeader(3),
  OFFER_HEADER,
  periodHeader(4),
  OFFER_HEADER,
  `Plus Komisyona Esas Fiyat${DOTLESS_I}`,
  `Plus Fiyat Se${C_CEDILLA}imi`,
  `Tarife Se${C_CEDILLA}imi`,
  'External Id',
  computedHeader(3),
  computedHeader(4),
  `${I_DOTTED_UPPER}ptal`,
  'Tarife Grubu',
  `3 ${GUN} Tarih ${ARALIGI}`,
  `4 ${GUN} Tarih ${ARALIGI}`,
  `7 ${GUN} Tarih ${ARALIGI}`,
  `External Id (3 ${GUN})`,
  `External Id (4 ${GUN})`,
  `External Id (7 ${GUN})`,
];

// Column indices of PLUS_HEADER (the legacy resolver's test held the same numbers).
const COL = {
  productTitle: 0,
  barcode: 2,
  sellerStockCode: 3,
  size: 4,
  modelCode: 5,
  category: 6,
  brand: 7,
  stock: 8,
  currentPrice: 9,
  commissionBasePrice: 10,
  currentCommission: 11,
  plusPriceUpperLimit: 12,
  plusCommissionBasePrice: 15,
  plusPriceSelection: 16,
  tariffSelection: 17,
  cancelled: 19,
  externalId: 20,
  tariffGroup: 21,
} as const;

// The 7-day block of PLUS_HEADER: its label, its offer, its computed commission.
const LABEL_COL = 13;
const OFFER_COL = 14;
const COMPUTED_COL = 18;

// Column indices of PLUS_HEADER_MULTI that differ from PLUS_HEADER.
const MULTI_COL = {
  plusCommissionBasePrice: 17,
  plusPriceSelection: 18,
  tariffSelection: 19,
  externalId: 20,
  cancelled: 23,
  tariffGroup: 24,
} as const;

const REQUIRED_KEYS = [
  'barcode',
  'currentPrice',
  'currentCommission',
  'plusPriceUpperLimit',
] as const;

// A synthetic data row under PLUS_HEADER every literal case starts from.
const BASE_ROW: Readonly<Record<number, CellValue>> = {
  [COL.productTitle]: 'Product',
  [COL.barcode]: 'BC-1',
  [COL.sellerStockCode]: 'SELLER-1',
  [COL.modelCode]: 'MODEL-1',
  [COL.category]: 'Bayrak',
  [COL.brand]: 'Brand',
  [COL.stock]: 33,
  [COL.currentPrice]: 472.5,
  [COL.commissionBasePrice]: 448.87,
  [COL.currentCommission]: 19,
  [COL.plusPriceUpperLimit]: 377.66,
  [LABEL_COL]: '30 Haziran 08.00-7 Temmuz 07.59',
  [OFFER_COL]: 15.4,
  [COL.plusCommissionBasePrice]: 440.1,
  [COL.externalId]: 'ext-1',
  [COL.tariffGroup]: 'group-1',
};

/** A data row under PLUS_HEADER: BASE_ROW with `overrides` written over it (null blanks a cell). */
function dataRow(overrides: Readonly<Record<number, CellValue>> = {}): CellValue[] {
  return PLUS_HEADER.map((_, col) => {
    if (Object.hasOwn(overrides, col)) return overrides[col] ?? null;
    return BASE_ROW[col] ?? null;
  });
}

function present<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`${what} is missing`);
  return value;
}

function headerLayout(header: readonly string[]): ResolvedLayout | null {
  return resolveLayout(format.layout, [[...header]]);
}

function gridSelection(grid: SheetData) {
  return { format, grid, layout: present(resolveLayout(format.layout, grid), 'layout') };
}

/** The mapped row of one synthetic data row. */
function mapOne(overrides: Readonly<Record<number, CellValue>> = {}): PlusCommissionTariffRow {
  const read = readRows(gridSelection([[...PLUS_HEADER], dataRow(overrides)]));
  return present(read.rows[0], 'kept row').data;
}

/** The four price cells of a synthetic row, each set to `cell`. */
function allPrices(cell: CellValue): Readonly<Record<number, CellValue>> {
  return {
    [COL.currentPrice]: cell,
    [COL.commissionBasePrice]: cell,
    [COL.plusPriceUpperLimit]: cell,
    [COL.plusCommissionBasePrice]: cell,
  };
}

/** The four prices of a mapped row: current, commission base, Plus ceiling, Plus commission base. */
function pricesOf(row: PlusCommissionTariffRow): readonly (string | null)[] {
  return [
    row.currentPrice,
    row.commissionBasePrice,
    row.plusPriceUpperLimit,
    row.plusCommissionBasePrice,
  ];
}

const NO_PRICES = [null, null, null, null];

function column(layout: ResolvedLayout, key: PlusColumn): number | null {
  return columnIndex(format.layout, layout, key);
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

/** A golden entry's digest of `kind`; every Plus fixture has a `real` one, the single-period fixture a `derived` one too. */
function goldenDigest(file: string, kind: 'real' | 'derived'): GoldenDigest {
  const golden: unknown = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));
  if (typeof golden !== 'object' || golden === null) throw new Error('golden is not an object');
  const entry: unknown = Reflect.get(golden, file);
  if (typeof entry !== 'object' || entry === null) throw new Error(`no golden entry: ${file}`);
  const value: unknown = Reflect.get(entry, kind);
  if (!isDigest(value)) throw new Error(`bad golden entry: ${file} ${kind}`);
  return value;
}

function digest(read: { rows: readonly { data: unknown }[]; skippedRows: number }): GoldenDigest {
  return {
    keptRows: read.rows.length,
    skippedRows: read.skippedRows,
    sha256: sha256Hex(canonicalJson(read.rows.map((r) => r.data))),
  };
}

async function realSelection(file: Buffer) {
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

/** The write columns of a layout as [key, tag, column] triples. */
function writeColumnsOf(layout: ResolvedLayout): unknown[] {
  return resolveWriteColumns(format, layout).map((entry) => [entry.key, entry.tag, entry.col]);
}

describe('Trendyol Plus commission tariff format: headers', () => {
  it('is the header row of both real fixtures', async () => {
    expect((await realSelection(SINGLE)).grid[0]).toEqual(PLUS_HEADER);
    expect((await realSelection(MULTI)).grid[0]).toEqual(PLUS_HEADER_MULTI);
  });

  it('is recognised by its fingerprint headers', () => {
    expect(format.fingerprint).toEqual(TRENDYOL_FINGERPRINTS.PLUS_COMMISSION_TARIFF);
    for (const name of format.fingerprint) expect(PLUS_HEADER).toContain(name);
  });

  it('resolves every column of the real single-period header by name', () => {
    const layout = present(headerLayout(PLUS_HEADER), 'layout');

    const keys = Object.keys(COL).filter((key): key is keyof typeof COL => Object.hasOwn(COL, key));
    for (const key of keys) {
      expect([key, column(layout, key)]).toEqual([key, COL[key]]);
    }
    // One 7-day period: its offer sits right after its label, and its computed
    // commission column is found by "Hesaplanan Komisyon (7 Gun)".
    const blocks = layout.blocks.get('periods') ?? [];
    expect(blocks.map((block) => block.tag)).toEqual([7]);
    expect(blocks[0]?.columns.get('label')).toBe(LABEL_COL);
    expect(blocks[0]?.columns.get('offer')).toBe(OFFER_COL);
    expect(blocks[0]?.lookups.get('computedCommission')).toBe(COMPUTED_COL);
  });

  it('resolves both periods of the two-period header, offer and computed commission per period', () => {
    const layout = present(headerLayout(PLUS_HEADER_MULTI), 'layout');

    // Two periods in sheet order; the trailing decoys open none.
    const blocks = layout.blocks.get('periods') ?? [];
    expect(
      blocks.map((block) => [
        block.tag,
        block.columns.get('label'),
        block.columns.get('offer'),
        block.lookups.get('computedCommission'),
      ]),
    ).toEqual([
      [3, 13, 14, 21],
      [4, 15, 16, 22],
    ]);
    // Columns past the second block still resolve by name.
    const keys = Object.keys(MULTI_COL).filter((key): key is keyof typeof MULTI_COL =>
      Object.hasOwn(MULTI_COL, key),
    );
    for (const key of keys) {
      expect([key, column(layout, key)]).toEqual([key, MULTI_COL[key]]);
    }
  });

  it('resolves without the computed commission columns (the lookup is absent, not required)', () => {
    const layout = present(
      headerLayout(PLUS_HEADER.filter((h) => !h.startsWith('Hesaplanan Komisyon'))),
      'layout',
    );

    expect(layout.blocks.get('periods')?.[0]?.lookups.get('computedCommission')).toBeNull();
  });

  it('resolves the lower-case spelling of the period header', () => {
    const lower = `Tarih aral${DOTLESS_I}${G_BREVE}${DOTLESS_I} (7 ${GUN})`;
    const layout = present(
      headerLayout(PLUS_HEADER.map((h) => (h === periodHeader(7) ? lower : h))),
      'layout',
    );

    expect(layout.blocks.get('periods')?.map((block) => block.tag)).toEqual([7]);
  });

  it('does not resolve when the column after a period label is not the offer column', () => {
    const other = `Bir Ba${S_CEDILLA}ka Kolon`;
    expect(headerLayout(PLUS_HEADER.map((h) => (h === OFFER_HEADER ? other : h)))).toBeNull();
  });

  it('does not resolve without a period header', () => {
    expect(headerLayout(PLUS_HEADER.filter((h) => !h.startsWith('Tarih')))).toBeNull();
  });

  it.each(REQUIRED_KEYS)('does not resolve without the required column %s', (key) => {
    expect(headerLayout(PLUS_HEADER.filter((_, col) => col !== COL[key]))).toBeNull();
  });

  it('does not resolve a header that is not the Plus header', () => {
    expect(headerLayout(['not', 'a', 'plus', 'header'])).toBeNull();
  });
});

describe('Trendyol Plus commission tariff format: write columns', () => {
  it('resolves four write columns in the single-period file', () => {
    expect(writeColumnsOf(present(headerLayout(PLUS_HEADER), 'layout'))).toEqual([
      ['plusPriceSelection', null, 16],
      ['tariffSelection', null, 17],
      ['computedCommission', 7, 18],
      ['cancelled', null, 19],
    ]);
  });

  it('resolves five write columns in the two-period file, one computed commission per period', () => {
    expect(writeColumnsOf(present(headerLayout(PLUS_HEADER_MULTI), 'layout'))).toEqual([
      ['plusPriceSelection', null, 18],
      ['tariffSelection', null, 19],
      ['computedCommission', 3, 21],
      ['computedCommission', 4, 22],
      ['cancelled', null, 23],
    ]);
  });

  it('may overwrite the formula cells of every write column, a different list per file', async () => {
    const single = await realSelection(SINGLE);
    const multi = await realSelection(MULTI);

    const singleColumns = overwriteFormulaColumns(
      format,
      resolveWriteColumns(format, single.layout),
    );
    const multiColumns = overwriteFormulaColumns(format, resolveWriteColumns(format, multi.layout));

    expect(singleColumns).toEqual([16, 17, 18, 19]);
    expect(multiColumns).toEqual([18, 19, 21, 22, 23]);
    // The formula columns of the real files (selection, computed commission, cancel).
    expect(singleColumns).toEqual(expect.arrayContaining([17, 18, 19]));
    expect(multiColumns).toEqual(expect.arrayContaining([21, 22, 23]));
  });

  it('probes each write column with the widest value the export writes', () => {
    const probes = Object.fromEntries(
      Object.entries(format.writeBack).map(([key, write]) => [key, probeText(write.value)]),
    );

    expect(probes).toEqual({
      plusPriceSelection: '9999999999.99',
      tariffSelection: `7 ${TARIFF_WINDOW_LABEL_UNIT}`,
      computedCommission: '9999999999',
      cancelled: NO_LABEL,
    });
  });

  it('needs the Plus price or the tariff selection column to export', () => {
    expect(format.exportRequires).toEqual([['plusPriceSelection', 'tariffSelection']]);
  });
});

describe('Trendyol Plus commission tariff format: rows of the real files', () => {
  it('maps the first, a middle and the last row of the single-period file in full', async () => {
    const read = readRows(await realSelection(SINGLE));
    const byRow = new Map(read.rows.map((r) => [r.excelRow, r]));
    const tariffGroup = 'd2f254a0-65f7-44d2-8851-dd71e719ef4e';

    expect(byRow.get(2)).toStrictEqual({
      excelRow: 2,
      anchor: '85697423698',
      data: {
        barcode: '85697423698',
        stockCode: '23645f78988d',
        productTitle: `${TURK_BAYRAGI} 120${TIMES}180 cm (1,2 x 1,8 metre) ${EN_DASH} Canl${DOTLESS_I} ve Parlak ${RASEL} ${KUMAS}, ${CIFT_DIKIS}`,
        category: 'Bayrak',
        brand: 'AKYILDIZ store',
        size: null,
        modelCode: '23645f78988d',
        stock: 33,
        currentPrice: '472.5',
        commissionBasePrice: '448.87',
        currentCommissionPct: '19',
        plusPriceUpperLimit: '377.66',
        plusCommissionBasePrice: '448.87',
        externalId: null,
        tariffGroup,
        cancelled: false,
        periodOffers: ['15.4'],
      },
    });
    expect(byRow.get(6)).toStrictEqual({
      excelRow: 6,
      anchor: 'TB60X90A',
      data: {
        barcode: 'TB60X90A',
        stockCode: 'TB60X90A',
        productTitle: `60x90 Cm ${KUMAS} ${TURK_BAYRAGI}`,
        category: 'Bayrak',
        brand: 'Alpaka',
        size: null,
        modelCode: 'TB60X90A',
        stock: 73,
        currentPrice: '170',
        commissionBasePrice: '170',
        currentCommissionPct: '19',
        plusPriceUpperLimit: '135.81',
        plusCommissionBasePrice: '170',
        externalId: null,
        tariffGroup,
        cancelled: false,
        periodOffers: ['14.4'],
      },
    });
    expect(byRow.get(56)).toStrictEqual({
      excelRow: 56,
      anchor: 'TYB5EFHHSUF53HP658',
      data: {
        barcode: 'TYB5EFHHSUF53HP658',
        stockCode: '400x600cm',
        productTitle: `400x600 Cm Alpaka ${KUMAS} ${TURK_BAYRAGI}`,
        category: 'Bayrak',
        brand: `${RASEL} kuma${S_CEDILLA}`,
        size: null,
        modelCode: '400x600cm',
        stock: 50,
        currentPrice: '2600',
        commissionBasePrice: '2600',
        currentCommissionPct: '19',
        plusPriceUpperLimit: '1777.92',
        plusCommissionBasePrice: '2600',
        externalId: null,
        tariffGroup,
        cancelled: false,
        periodOffers: ['8.6'],
      },
    });
  });

  it('maps the first row of the two-period file with one offer per period', async () => {
    const read = readRows(await realSelection(MULTI));

    expect(read.rows[0]).toStrictEqual({
      excelRow: 2,
      anchor: '2902003000019',
      data: {
        barcode: '2902003000019',
        stockCode: 'TBR-RAS-200x300',
        productTitle: `${TURK_BAYRAGI} 200${TIMES}300 cm (2x3 metre) ${EN_DASH} ${RASEL} ${KUMAS}, ${CIFT_DIKIS}`,
        category: 'Bayrak',
        brand: 'AKYILDIZ store',
        size: null,
        modelCode: 'TBR-RAS-200x300',
        stock: 416,
        currentPrice: '933.45',
        commissionBasePrice: '886.78',
        currentCommissionPct: '19',
        plusPriceUpperLimit: '740.77',
        plusCommissionBasePrice: '886.78',
        externalId: null,
        tariffGroup: 'f342732d-532c-4e1a-9291-1629817e7404',
        cancelled: false,
        periodOffers: ['10.7', '13.1'],
      },
    });
  });

  it('finds no row the seller already filled in, in either real file', async () => {
    for (const file of [SINGLE, MULTI]) {
      const selection = await realSelection(file);
      const read = readRows(selection);
      const resolved = resolveWriteColumns(format, selection.layout);

      expect(countPrefilled(selection, read.rows, resolved)).toBe(0);
    }
  });
});

describe('Trendyol Plus commission tariff format: the row fallbacks', () => {
  it('reads the stock code from the model code, else the seller stock code, else null', () => {
    expect(mapOne()).toMatchObject({ stockCode: 'MODEL-1', modelCode: 'MODEL-1' });
    expect(mapOne({ [COL.modelCode]: null })).toMatchObject({
      stockCode: 'SELLER-1',
      modelCode: null,
    });
    expect(mapOne({ [COL.modelCode]: null, [COL.sellerStockCode]: null }).stockCode).toBeNull();
  });

  it('reads the commission base price, else the current price, else null', () => {
    expect(mapOne().commissionBasePrice).toBe('448.87');
    expect(mapOne({ [COL.commissionBasePrice]: null }).commissionBasePrice).toBe('472.5');
    expect(
      mapOne({ [COL.commissionBasePrice]: null, [COL.currentPrice]: null }).commissionBasePrice,
    ).toBeNull();
  });

  it('reads the Plus commission base price, else the Plus price ceiling, else null', () => {
    expect(mapOne().plusCommissionBasePrice).toBe('440.1');
    expect(mapOne({ [COL.plusCommissionBasePrice]: null }).plusCommissionBasePrice).toBe('377.66');
    expect(
      mapOne({ [COL.plusCommissionBasePrice]: null, [COL.plusPriceUpperLimit]: null })
        .plusCommissionBasePrice,
    ).toBeNull();
  });

  it('reads a blank current price, Plus price ceiling and current commission as null', () => {
    const row = mapOne({
      [COL.currentPrice]: null,
      [COL.currentCommission]: null,
      [COL.plusPriceUpperLimit]: null,
    });

    expect([row.currentPrice, row.currentCommissionPct, row.plusPriceUpperLimit]).toEqual([
      null,
      null,
      null,
    ]);
  });

  // Every price cell is set, so neither base price falls back to a known price.
  it('reads an unreadable price text as null', () => {
    expect(pricesOf(mapOne(allPrices('249,90 TL')))).toEqual(NO_PRICES);
  });

  // The grid reader turns an error cell into '#ERROR_' and its text; a typed '#REF!'
  // text reads the same way.
  it.each(['#REF!', '#ERROR_#REF!'])('reads an error cell (%s) as null', (cell) => {
    expect(pricesOf(mapOne(allPrices(cell)))).toEqual(NO_PRICES);
  });

  it('reads a date or boolean price cell as null', () => {
    for (const cell of [new Date(Date.UTC(2026, 6, 1)), true, false]) {
      expect(pricesOf(mapOne(allPrices(cell)))).toEqual(NO_PRICES);
    }
  });

  // 0.004 is zero at the stored scale: it would store as 0.00.
  it.each([
    ['the number 0', 0],
    ['the text 0', '0'],
    ['the text 0,00', '0,00'],
    ['the number 0.004', 0.004],
  ])('reads a literal 0 price (%s) as null', (_name, cell) => {
    expect(pricesOf(mapOne(allPrices(cell)))).toEqual(NO_PRICES);
  });

  it('skips a 0 commission base price and falls back to the current price', () => {
    for (const cell of [0, '0', '0,00', 0.004]) {
      expect(mapOne({ [COL.commissionBasePrice]: cell }).commissionBasePrice).toBe('472.5');
    }
    expect(
      mapOne({ [COL.commissionBasePrice]: 0, [COL.currentPrice]: 0 }).commissionBasePrice,
    ).toBeNull();
  });

  it('skips a 0 Plus commission base price and falls back to the Plus price ceiling', () => {
    for (const cell of [0, '0', '0,00', 0.004]) {
      expect(mapOne({ [COL.plusCommissionBasePrice]: cell }).plusCommissionBasePrice).toBe(
        '377.66',
      );
    }
    expect(
      mapOne({ [COL.plusCommissionBasePrice]: 0, [COL.plusPriceUpperLimit]: 0 })
        .plusCommissionBasePrice,
    ).toBeNull();
  });

  it("keeps a readable price as the file's text", () => {
    expect(pricesOf(mapOne())).toEqual(['472.5', '448.87', '377.66', '440.1']);
    expect(pricesOf(mapOne(allPrices(249.9)))).toEqual(['249.9', '249.9', '249.9', '249.9']);
    expect(pricesOf(mapOne(allPrices('249,90')))).toEqual(['249.90', '249.90', '249.90', '249.90']);
    // Not zero at the stored scale: it stores as 0.01.
    expect(pricesOf(mapOne(allPrices(0.005)))).toEqual(['0.005', '0.005', '0.005', '0.005']);
  });

  // An unknown percent is null, never 0%: the screens never price it and the export
  // never writes it.
  it('reads a blank current commission and a blank period offer as null', () => {
    const row = mapOne({ [COL.currentCommission]: null, [OFFER_COL]: null });

    expect(row.currentCommissionPct).toBeNull();
    expect(row.periodOffers).toEqual([null]);
  });

  it('reads an unreadable current commission as null', () => {
    expect(mapOne({ [COL.currentCommission]: '19 TL' }).currentCommissionPct).toBeNull();
    expect(mapOne({ [COL.currentCommission]: '#ERROR_#REF!' }).currentCommissionPct).toBeNull();
  });

  it('reads a blank or unreadable period offer as null', () => {
    expect(mapOne({ [OFFER_COL]: null }).periodOffers).toEqual([null]);
    expect(mapOne({ [OFFER_COL]: '15 TL' }).periodOffers).toEqual([null]);
    expect(mapOne({ [OFFER_COL]: '12,5' }).periodOffers).toEqual(['12.5']);
  });

  // A readable 0 is a real 0% commission, kept as the file's text (never null).
  it('keeps a zero period offer as 0', () => {
    expect(mapOne({ [OFFER_COL]: 0 }).periodOffers).toEqual(['0']);
    expect(mapOne({ [OFFER_COL]: '0' }).periodOffers).toEqual(['0']);
    expect(mapOne({ [OFFER_COL]: '0,00' }).periodOffers).toEqual(['0.00']);
  });

  it('keeps a zero current commission as 0', () => {
    expect(mapOne({ [COL.currentCommission]: 0 }).currentCommissionPct).toBe('0');
    expect(mapOne({ [COL.currentCommission]: '0,00' }).currentCommissionPct).toBe('0.00');
  });

  it('falls back to the barcode for a blank title and reads blank optional columns as null', () => {
    expect(
      mapOne({
        [COL.productTitle]: null,
        [COL.category]: null,
        [COL.brand]: null,
        [COL.size]: null,
        [COL.stock]: null,
        [COL.externalId]: null,
        [COL.tariffGroup]: null,
      }),
    ).toMatchObject({
      productTitle: 'BC-1',
      category: null,
      brand: null,
      size: null,
      stock: null,
      externalId: null,
      tariffGroup: null,
    });
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

  it('reads the decimal cells with the plain grammar, without rounding', () => {
    const row = mapOne({
      [COL.currentPrice]: '1.234,56',
      [COL.plusPriceUpperLimit]: '1.100',
      [COL.commissionBasePrice]: '350 TL',
    });

    expect([row.currentPrice, row.plusPriceUpperLimit, row.commissionBasePrice]).toEqual([
      '1234.56',
      '1.100',
      '1234.56',
    ]);
  });

  it('reads every optional column as absent on a sheet of the required columns and the period', () => {
    const kept = new Set<number>([...REQUIRED_KEYS.map((key) => COL[key]), LABEL_COL, OFFER_COL]);
    const header = PLUS_HEADER.filter((_, col) => kept.has(col));
    const row = dataRow().filter((_, col) => kept.has(col));

    const read = readRows(gridSelection([[...header], row]));

    expect(read.rows[0]?.data).toStrictEqual({
      barcode: 'BC-1',
      stockCode: null,
      productTitle: 'BC-1',
      category: null,
      brand: null,
      size: null,
      modelCode: null,
      stock: null,
      currentPrice: '472.5',
      commissionBasePrice: '472.5',
      currentCommissionPct: '19',
      plusPriceUpperLimit: '377.66',
      plusCommissionBasePrice: '377.66',
      externalId: null,
      tariffGroup: null,
      cancelled: false,
      periodOffers: ['15.4'],
    });
  });
});

describe('Trendyol Plus commission tariff format: the keep rule and the cancel cell', () => {
  it('skips a row without a barcode, and keeps the sheet order of the rest', () => {
    const grid: SheetData = [
      [...PLUS_HEADER],
      dataRow({ [COL.barcode]: 'B-002' }),
      dataRow({ [COL.barcode]: null }),
      dataRow({ [COL.barcode]: '   ' }),
      dataRow({ [COL.barcode]: 'C-003' }),
      dataRow({ [COL.barcode]: 'A-001' }),
    ];

    const read = readRows(gridSelection(grid));

    expect(read.rows.map((row) => row.anchor)).toEqual(['B-002', 'C-003', 'A-001']);
    expect(read.skippedRows).toBe(2);
  });

  // Ported from the layout parity test: the number 1 cancels, the text "0" does not.
  it('reads the cancel cell as a number: the number 1 cancels, the text "0" does not', async () => {
    const fixture = (await realSelection(SINGLE)).grid;
    const grid = derivedGrid(format.layout, format.keep, fixture, [
      PLUS_CANCEL_NUMBER_ONE,
      PLUS_CANCEL_TEXT_ZERO,
    ]);
    const layout = present(resolveLayout(format.layout, grid), 'layout');
    const cancelled = (row: CellValue[] | undefined): boolean =>
      createRowReader(format.layout, layout, row ?? [], READER_OPTIONS).numericFlag('cancelled');

    expect(cancelled(grid.at(-2))).toBe(true);
    expect(cancelled(grid.at(-1))).toBe(false);
    expect(
      readRows(gridSelection(grid))
        .rows.slice(-2)
        .map((row) => row.data.cancelled),
    ).toEqual([true, false]);
  });

  it.each([
    ['the number 1', true, 1],
    ['the text 1', true, '1'],
    ['the number -1', true, -1],
    ['the text 0', false, '0'],
    ['the fraction 0.5', false, 0.5],
    ['the no label', false, NO_LABEL],
    ['a blank cell', false, null],
  ])('reads a cancel cell of %s as %s', (_name, expected, cell) => {
    expect(mapOne({ [COL.cancelled]: cell }).cancelled).toBe(expected);
  });
});

describe('Trendyol Plus commission tariff format: a value the export could not write', () => {
  // The first kept row of the single-period file. Choosing Plus without a custom price
  // writes the Plus price ceiling into "Plus Fiyat Secimi", and every chosen item writes
  // its period's offer into "Hesaplanan Komisyon (N Gun)".
  const FIRST_KEPT_ROW = 2;

  function withCell(col: number, value: string): Buffer {
    return patchFixture(
      SINGLE,
      [{ excelRow: FIRST_KEPT_ROW, col, value: { kind: 'number', value } }],
      {
        sheet: format.sheet,
      },
    );
  }

  async function expectUnwritable(file: Buffer, value: string): Promise<void> {
    const selection = await realSelection(file);

    const err = captureThrow(() => readRows(selection));

    expect(err).toBeInstanceOf(SpreadsheetFileError);
    if (!(err instanceof SpreadsheetFileError)) return;
    expect(err.code).toBe('MALFORMED_SHEET');
    expect(err.meta).toEqual({ reason: UNWRITABLE_VALUE_REASON });
    expect(err.message).not.toContain(value);
  }

  // A negative ceiling, and one with eleven integer digits.
  it.each(['-5', '12345678901'])(
    'refuses a Plus price ceiling of %s with MALFORMED_SHEET unwritable-value',
    async (value) => {
      const file = withCell(COL.plusPriceUpperLimit, value);
      const selection = await realSelection(file);
      expect(column(selection.layout, 'plusPriceUpperLimit')).toBe(COL.plusPriceUpperLimit);

      await expectUnwritable(file, value);
    },
  );

  // A known offer is still write-checked: a negative one, and one with eleven integer
  // digits.
  it('still refuses a negative or too-wide offer', () => {
    for (const cell of [-1, 12345678901]) {
      const err = captureThrow(() => mapOne({ [OFFER_COL]: cell }));

      expect(err).toBeInstanceOf(SpreadsheetFileError);
      if (!(err instanceof SpreadsheetFileError)) return;
      expect(err.code).toBe('MALFORMED_SHEET');
      expect(err.meta).toEqual({ reason: UNWRITABLE_VALUE_REASON });
    }
  });

  // An unknown offer is never written, so a cell that would be refused if it read as a
  // number (a negative one, one with eleven integer digits) reads as null and passes.
  it('does not write-check an unknown offer', () => {
    for (const cell of [null, '-1 TL', '12345678901 TL', '#ERROR_#REF!', true]) {
      expect(mapOne({ [OFFER_COL]: cell }).periodOffers).toEqual([null]);
    }
  });

  it('refuses a negative period offer with MALFORMED_SHEET unwritable-value', async () => {
    const file = withCell(OFFER_COL, '-1');
    const selection = await realSelection(file);
    expect(selection.layout.blocks.get('periods')?.[0]?.columns.get('offer')).toBe(OFFER_COL);

    await expectUnwritable(file, '-1');
  });

  // The database rounds an offer to four decimals and the export writes that stored value,
  // so an Excel float residue or a long fraction is kept as the file's own text.
  it.each(['15.400000000000002', '1.123456789', '99.9999'])(
    'keeps a period offer of %s, which the export writes rounded to four decimals',
    async (value) => {
      const read = readRows(await realSelection(withCell(OFFER_COL, value)));

      expect(read.rows[0]?.excelRow).toBe(FIRST_KEPT_ROW);
      expect(read.rows[0]?.data.periodOffers).toEqual([value]);
      expect(read.rows.length).toBe(55);
    },
  );

  it('keeps a Plus price ceiling as wide as the export writes', async () => {
    const read = readRows(await realSelection(withCell(COL.plusPriceUpperLimit, '9999999999.99')));

    expect(read.rows[0]?.excelRow).toBe(FIRST_KEPT_ROW);
    expect(read.rows[0]?.data.plusPriceUpperLimit).toBe('9999999999.99');
    expect(read.rows.length).toBe(55);
  });

  it('does not check a value the export never writes: the prices and the current commission', async () => {
    const current = readRows(await realSelection(withCell(COL.currentPrice, '12345678901')));
    const base = readRows(await realSelection(withCell(COL.commissionBasePrice, '-5')));
    const commission = readRows(await realSelection(withCell(COL.currentCommission, '-5')));
    const plusBase = readRows(
      await realSelection(withCell(COL.plusCommissionBasePrice, '12345678901')),
    );

    expect(current.rows[0]?.data.currentPrice).toBe('12345678901');
    expect(base.rows[0]?.data.commissionBasePrice).toBe('-5');
    expect(commission.rows[0]?.data.currentCommissionPct).toBe('-5');
    expect(plusBase.rows[0]?.data.plusCommissionBasePrice).toBe('12345678901');
  });
});

describe('Trendyol Plus commission tariff format: the import rehearsal on the real files', () => {
  async function rehearse(file: Buffer) {
    const selection = await realSelection(file);
    const read = readRows(selection);
    const resolved = resolveWriteColumns(format, selection.layout);
    return buildRehearsal(selection, rehearsalTargets('anchor-map', read), resolved);
  }

  it('rehearses every write column of every row of both files with their own formula columns', async () => {
    for (const [file, rows, columns] of [
      [SINGLE, 55, [16, 17, 18, 19]],
      [MULTI, 33, [18, 19, 21, 22, 23]],
    ] as const) {
      const rehearsal = await rehearse(file);
      expect(rehearsal.overwriteFormulaColumns).toEqual(columns);
      expect(rehearsal.patches).toHaveLength(rows * columns.length);

      const patched = patchFixture(file, rehearsal.patches, {
        sheet: format.sheet,
        overwriteFormulaColumns: rehearsal.overwriteFormulaColumns,
      });
      expect(patched.equals(file)).toBe(false);
    }
  });

  it("refuses the rehearsal with the other file's formula columns (MALFORMED_SHEET formula-target)", async () => {
    const single = await rehearse(SINGLE);
    const multi = await rehearse(MULTI);

    for (const [file, rehearsal, other] of [
      [SINGLE, single, multi.overwriteFormulaColumns],
      [MULTI, multi, single.overwriteFormulaColumns],
    ] as const) {
      const err = captureThrow(() =>
        patchFixture(file, rehearsal.patches, {
          sheet: format.sheet,
          overwriteFormulaColumns: other,
        }),
      );

      expect(err).toBeInstanceOf(SpreadsheetFileError);
      if (!(err instanceof SpreadsheetFileError)) return;
      expect(err.code).toBe('MALFORMED_SHEET');
      expect(err.meta['reason']).toBe(MALFORMED_SHEET_REASONS.FORMULA_TARGET);
    }
  });
});

describe('Trendyol Plus commission tariff format: the legacy golden digests', () => {
  it("reads both real files to the legacy parser's digests", async () => {
    const single = readRows(await realSelection(SINGLE));
    const multi = readRows(await realSelection(MULTI));

    expect(digest(single)).toEqual(goldenDigest(SINGLE_FILE, 'real'));
    expect(digest(multi)).toEqual(goldenDigest(MULTI_FILE, 'real'));
    expect([single.rows.length, single.skippedRows]).toEqual([55, 0]);
    expect([multi.rows.length, multi.skippedRows]).toEqual([33, 0]);
  });

  it("reads the derived rows to the legacy parser's digest, dropped and kept rows included", async () => {
    const fixture = (await realSelection(SINGLE)).grid;
    const grid = derivedGrid(format.layout, format.keep, fixture, PLUS_DERIVED);
    const read = readRows(gridSelection(grid));
    const real = goldenDigest(SINGLE_FILE, 'real');
    const derived = goldenDigest(SINGLE_FILE, 'derived');
    const keptNames = PLUS_DERIVED.filter((testCase) => testCase.kept).map(
      (testCase) => testCase.name,
    );
    const keptCases = keptNames.length;
    // The kept derived rows follow the fixture's own kept rows, in case order.
    const derivedRow = (name: string): PlusCommissionTariffRow => {
      const index = keptNames.indexOf(name);
      expect(index).toBeGreaterThanOrEqual(0);
      return present(read.rows[real.keptRows + index], name).data;
    };

    // An unknown price reads as null: a blank cell, and a text that does not read. A base
    // price falls back to its known partner and is null only when both are unknown.
    expect(pricesOf(derivedRow('a blank current price'))).toEqual([
      null,
      '448.87',
      '377.66',
      '448.87',
    ]);
    expect(pricesOf(derivedRow('a blank Plus price upper limit'))).toEqual([
      '472.5',
      '448.87',
      null,
      '448.87',
    ]);
    expect(pricesOf(derivedRow('a blank commission base price and current price'))).toEqual([
      null,
      null,
      '377.66',
      '448.87',
    ]);
    expect(
      pricesOf(derivedRow('a blank Plus commission base price and Plus price upper limit')),
    ).toEqual(['472.5', '448.87', null, null]);
    expect(pricesOf(derivedRow('lira-suffixed prices and offer'))).toEqual([
      null,
      null,
      null,
      '448.87',
    ]);
    // An unknown percent reads as null, never as 0: a blank cell, and a text that does
    // not read. A readable 0 offer stays '0'.
    expect(derivedRow('a blank current commission').currentCommissionPct).toBeNull();
    expect(derivedRow('a blank period offer').periodOffers).toEqual([null]);
    expect(derivedRow('lira-suffixed prices and offer').periodOffers).toEqual([null]);
    expect(derivedRow('a zero period offer').periodOffers).toEqual(['0']);
    expect(digest(read)).toEqual(derived);
    // Every derived case lands on the side its `kept` flag names.
    expect(read.rows.length).toBe(real.keptRows + keptCases);
    expect(read.skippedRows).toBe(real.skippedRows + PLUS_DERIVED.length - keptCases);
    // The derived grid both drops and keeps rows, so its digest pins a row mapping and
    // not only a skipped count.
    expect(read.skippedRows).toBe(2);
    expect(read.rows.length).toBe(81);
    expect(derived.keptRows).toBeGreaterThan(real.keptRows);
    expect(derived.sha256).not.toBe(real.sha256);
  });
});
