// The Trendyol commission tariff format on its own, with no legacy code: the header
// cases of the old resolver's test and of the commission block of the layout parity
// test, the write columns of both real files and the formula columns the export may
// overwrite, literal rows of the real files, the row fallbacks, a current price or band
// price the export could not write, the permanent golden digests of
// tests/fixtures/workbook-golden/legacy-rows.json (written by the legacy import parser
// before it was deleted), the rows the real files already fill in, and the import
// rehearsal on both real files. A change to `mapRow` or the keep rule that alters any
// field of any row, on the real files or on the derived rows, fails here.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  cellText,
  columnIndex,
  readWorkbookGrid,
  resolveLayout,
  SpreadsheetFileError,
  type CellPatch,
  type CellValue,
  type ColumnKey,
  type ResolvedLayout,
  type SheetData,
} from '@pazarsync/spreadsheet';
import { patchFixture } from '@pazarsync/spreadsheet/testing';
import { describe, expect, it, vi } from 'vitest';

import { VALUE_OUT_OF_RANGE_REASON } from '@/workbooks/column-range';
import { FORMAT_SUMMARIES } from '@/workbooks/formats/registry';
import {
  trendyolCommissionTariffFormat,
  type CommissionTariffRow,
} from '@/workbooks/formats/trendyol/commission-tariff.format';
import {
  TARIFF_WINDOW_LABEL_UNIT,
  TRENDYOL_FINGERPRINTS,
} from '@/workbooks/formats/trendyol/labels';
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
import { blockColumn, blocksOf } from '../../../helpers/layout-blocks';
import { COMMISSION_DERIVED, derivedGrid } from '../../../helpers/workbook-derived-rows';

// The fixtures are read through the parse worker, whose cold start can pass vitest's 5 s
// default under load.
vi.setConfig({ testTimeout: 60_000 });

const MULTI_FILE = 'trendyol-commission-tariff.xlsx';
const SINGLE_FILE = 'trendyol-tariff-1period.xlsx';
const FIXTURES_DIR = resolve(__dirname, '../../../fixtures');
const MULTI = readFileSync(resolve(FIXTURES_DIR, MULTI_FILE));
const SINGLE = readFileSync(resolve(FIXTURES_DIR, SINGLE_FILE));
const GOLDEN_PATH = resolve(FIXTURES_DIR, 'workbook-golden/legacy-rows.json');

const format = trendyolCommissionTariffFormat;

type CommissionColumn = ColumnKey<typeof format.layout>;

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

const GUN = `G${U_UMLAUT}n`;
const KOMISYON = `KOM${I_DOTTED_UPPER}SYON`;
const TURK_BAYRAGI = `T${U_UMLAUT}rk Bayra${G_BREVE}${DOTLESS_I}`;
const KUMAS = `Kuma${S_CEDILLA}`;
const RASEL = `Ra${S_CEDILLA}el`;
const CIFT_DIKIS = `${C_CEDILLA_UPPER}ift Diki${S_CEDILLA}`;

const BARKOD = 'BARKOD';
const UPPER_LIMIT = `${U_UMLAUT_UPPER}st Limiti`;
const CURRENT_TSF = `G${U_UMLAUT_UPPER}NCEL TSF`;
const NEW_TSF = `YEN${I_DOTTED_UPPER} TSF (F${I_DOTTED_UPPER}YAT G${U_UMLAUT_UPPER}NCELLE)`;
const TARIFF_SELECTION = `Tarife Se${C_CEDILLA}imi`;

function periodHeader(days: number): string {
  return `Tarih aral${DOTLESS_I}${G_BREVE}${DOTLESS_I} (${days} ${GUN})`;
}

function computedHeader(days: number): string {
  return `Hesaplanan Komisyon (${days} ${GUN})`;
}

// Columns A-N: identity (A-H) and the four price brackets (I-N), as the legacy resolver's
// test held them.
const FIXED: readonly string[] = [
  `${U_UMLAUT_UPPER}R${U_UMLAUT_UPPER}N ${I_DOTTED_UPPER}SM${I_DOTTED_UPPER}`,
  BARKOD,
  'SATICI STOK KODU',
  'BEDEN',
  'MODEL KODU',
  `KATEGOR${I_DOTTED_UPPER}`,
  'MARKA',
  'STOK',
  '1.Fiyat Alt Limit',
  `2.Fiyat ${UPPER_LIMIT}`,
  '2.Fiyat Alt Limit',
  `3.Fiyat ${UPPER_LIMIT}`,
  '3.Fiyat Alt Limit',
  `4.Fiyat ${UPPER_LIMIT}`,
];

const COMMS: readonly string[] = [
  `1.${KOMISYON}`,
  `2.${KOMISYON}`,
  `3.${KOMISYON}`,
  `4.${KOMISYON}`,
];

const COMMISSION_BASE = `${KOMISYON}A ESAS F${I_DOTTED_UPPER}YAT`;
const CURRENT_COMMISSION = `G${U_UMLAUT_UPPER}NCEL ${KOMISYON}`;
const TARIFF_GROUP = `TAR${I_DOTTED_UPPER}FE GRUBU`;

// The real two-period (3 + 4 day, 35-column) header, as the legacy resolver's test held it.
const MULTI_HEADER: readonly string[] = [
  ...FIXED,
  periodHeader(3),
  ...COMMS,
  periodHeader(4),
  ...COMMS,
  COMMISSION_BASE,
  CURRENT_COMMISSION,
  CURRENT_TSF,
  NEW_TSF,
  computedHeader(3),
  computedHeader(4),
  TARIFF_SELECTION,
  'FIRST EXTERNAL ID',
  'SECOND EXTERNAL ID',
  'FULL EXTERNAL ID',
  TARIFF_GROUP,
];

// The real one-period (7 day, 27-column) header: the tail columns shift left.
const SINGLE_HEADER: readonly string[] = [
  ...FIXED,
  periodHeader(7),
  ...COMMS,
  COMMISSION_BASE,
  CURRENT_COMMISSION,
  CURRENT_TSF,
  NEW_TSF,
  computedHeader(7),
  TARIFF_SELECTION,
  'EXTERNAL ID',
  TARIFF_GROUP,
];

// Column indices of SINGLE_HEADER.
const COL = {
  productTitle: 0,
  barcode: 1,
  sellerStockCode: 2,
  size: 3,
  modelCode: 4,
  category: 5,
  brand: 6,
  stock: 7,
  band1Lower: 8,
  band2Upper: 9,
  band2Lower: 10,
  band3Upper: 11,
  band3Lower: 12,
  band4Upper: 13,
  commissionBasePrice: 19,
  currentCommission: 20,
  currentPrice: 21,
  newTsf: 22,
  tariffSelection: 24,
} as const;

// The 7-day block of SINGLE_HEADER: its label and its four commissions.
const LABEL_COL = 14;
const COMM_COLS = [15, 16, 17, 18] as const;

// Column indices of MULTI_HEADER that differ from SINGLE_HEADER (the legacy resolver's
// test held the same numbers).
const MULTI_COL = {
  commissionBasePrice: 24,
  currentCommission: 25,
  currentPrice: 26,
  newTsf: 27,
  tariffSelection: 30,
} as const;

// The 4-day block of MULTI_HEADER (the second block): its label and its commissions.
const MULTI_LABEL_4 = 19;
const MULTI_COMM_4 = [20, 21, 22, 23] as const;

// A synthetic data row under SINGLE_HEADER every literal case starts from.
const BASE_ROW: Readonly<Record<number, CellValue>> = {
  [COL.productTitle]: 'Product',
  [COL.barcode]: 'BC-1',
  [COL.sellerStockCode]: 'SELLER-1',
  [COL.modelCode]: 'MODEL-1',
  [COL.category]: 'Bayrak',
  [COL.brand]: 'Brand',
  [COL.stock]: 33,
  [COL.band1Lower]: 500.1,
  [COL.band2Upper]: 500.09,
  [COL.band2Lower]: 450.2,
  [COL.band3Upper]: 450.19,
  [COL.band3Lower]: 400.3,
  [COL.band4Upper]: 400.29,
  [LABEL_COL]: '30 Haziran 08.00-7 Temmuz 07.59',
  [COMM_COLS[0]]: 19,
  [COMM_COLS[1]]: 15.4,
  [COMM_COLS[2]]: 12.1,
  [COMM_COLS[3]]: 10.6,
  [COL.commissionBasePrice]: 520,
  [COL.currentCommission]: 19,
  [COL.currentPrice]: 540,
};

/** A data row under SINGLE_HEADER: BASE_ROW with `overrides` written over it (null blanks a cell). */
function dataRow(overrides: Readonly<Record<number, CellValue>> = {}): CellValue[] {
  return SINGLE_HEADER.map((_, col) => {
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
function mapOne(overrides: Readonly<Record<number, CellValue>> = {}): CommissionTariffRow {
  const read = readRows(gridSelection([[...SINGLE_HEADER], dataRow(overrides)]));
  return present(read.rows[0], 'kept row').data;
}

function column(layout: ResolvedLayout, key: CommissionColumn): number | null {
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

/** A golden entry's digest of `kind`; both fixtures have a `real` one, the 3+4 day fixture a `derived` one too. */
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

describe('Trendyol commission tariff format: headers', () => {
  it('is the header row of both real fixtures', async () => {
    expect((await realSelection(MULTI)).grid[0]).toEqual(MULTI_HEADER);
    expect((await realSelection(SINGLE)).grid[0]).toEqual(SINGLE_HEADER);
  });

  it('is recognised by its fingerprint headers', () => {
    expect(format.fingerprint).toEqual(TRENDYOL_FINGERPRINTS.COMMISSION_TARIFF);
    for (const name of format.fingerprint) expect(SINGLE_HEADER).toContain(name);
  });

  it('resolves the two-period (35-column) header: both periods and the shifted tail', () => {
    const layout = present(headerLayout(MULTI_HEADER), 'layout');

    const blocks = blocksOf(format.layout, layout, 'periods');
    expect(
      blocks.map((block) => [
        block.tag,
        blockColumn(format.layout, 'periods', block, 'label'),
        blockColumn(format.layout, 'periods', block, 'comm1'),
        blockColumn(format.layout, 'periods', block, 'comm2'),
        blockColumn(format.layout, 'periods', block, 'comm3'),
        blockColumn(format.layout, 'periods', block, 'comm4'),
      ]),
    ).toEqual([
      [3, 14, 15, 16, 17, 18],
      [4, 19, 20, 21, 22, 23],
    ]);
    const keys = Object.keys(MULTI_COL).filter((key): key is keyof typeof MULTI_COL =>
      Object.hasOwn(MULTI_COL, key),
    );
    for (const key of keys) {
      expect([key, column(layout, key)]).toEqual([key, MULTI_COL[key]]);
    }
  });

  it('resolves the one-period (27-column) header with shifted tail columns', () => {
    const layout = present(headerLayout(SINGLE_HEADER), 'layout');

    expect(blocksOf(format.layout, layout, 'periods').map((block) => block.tag)).toEqual([7]);
    const keys = Object.keys(COL).filter((key): key is keyof typeof COL => Object.hasOwn(COL, key));
    for (const key of keys) {
      expect([key, column(layout, key)]).toEqual([key, COL[key]]);
    }
  });

  // Ported from the layout parity test: the 3-day block of the 3+4 day fixture carries
  // no data, and still resolves.
  it('resolves both blocks of the 3+4 day fixture, the empty 3-day block included', async () => {
    const { layout } = await realSelection(MULTI);

    expect(blocksOf(format.layout, layout, 'periods').map((block) => block.tag)).toEqual([3, 4]);
  });

  it('resolves without the commission base price column (it is optional)', () => {
    const layout = present(
      headerLayout(SINGLE_HEADER.filter((h) => h !== COMMISSION_BASE)),
      'layout',
    );

    expect(column(layout, 'commissionBasePrice')).toBeNull();
  });

  it('does not resolve a header that is not a commission tariff header', () => {
    expect(headerLayout(['not', 'a', 'tariff', 'header'])).toBeNull();
  });

  it('does not resolve when the barcode sentinel moved', () => {
    const moved = [...SINGLE_HEADER];
    moved[COL.barcode] = 'SATICI STOK KODU';
    moved[COL.sellerStockCode] = BARKOD;

    expect(headerLayout(moved)).toBeNull();
  });

  it('does not resolve without a period block', () => {
    expect(headerLayout([...FIXED, CURRENT_TSF, NEW_TSF, TARIFF_SELECTION])).toBeNull();
  });

  it('does not resolve when a tail column is missing', () => {
    expect(headerLayout([...FIXED, periodHeader(4), ...COMMS, CURRENT_TSF])).toBeNull();
  });
});

describe('Trendyol commission tariff format: write columns', () => {
  it('resolves the new price and the tariff selection column of each file', () => {
    expect(writeColumnsOf(present(headerLayout(MULTI_HEADER), 'layout'))).toEqual([
      ['newTsf', null, 27],
      ['tariffSelection', null, 30],
    ]);
    expect(writeColumnsOf(present(headerLayout(SINGLE_HEADER), 'layout'))).toEqual([
      ['newTsf', null, 22],
      ['tariffSelection', null, 24],
    ]);
  });

  it('may overwrite the formula cells of its two write columns only, never a computed commission', async () => {
    const multi = await realSelection(MULTI);
    const single = await realSelection(SINGLE);

    const multiColumns = overwriteFormulaColumns(format, resolveWriteColumns(format, multi.layout));
    const singleColumns = overwriteFormulaColumns(
      format,
      resolveWriteColumns(format, single.layout),
    );

    expect(multiColumns).toEqual([27, 30]);
    expect(singleColumns).toEqual([22, 24]);
    // The computed commission formula columns (AC and AD of the 3+4 day file, X of the
    // 7 day file) are not write targets.
    expect(multi.grid[0]?.[28]).toBe(computedHeader(3));
    expect(multi.grid[0]?.[29]).toBe(computedHeader(4));
    expect(single.grid[0]?.[23]).toBe(computedHeader(7));
    expect(multiColumns).not.toContain(28);
    expect(multiColumns).not.toContain(29);
    expect(singleColumns).not.toContain(23);
  });

  it('probes each write column with the widest value the export writes', () => {
    const probes = Object.fromEntries(
      Object.entries(format.writeBack).map(([key, write]) => [key, probeText(write.value)]),
    );

    expect(probes).toEqual({
      newTsf: '9999999999.99',
      tariffSelection: `7 ${TARIFF_WINDOW_LABEL_UNIT}`,
    });
  });

  it('needs both the new price and the tariff selection column to export', () => {
    expect(format.exportRequires).toEqual([['newTsf'], ['tariffSelection']]);
  });
});

describe('Trendyol commission tariff format: rows of the real files', () => {
  it('maps the first and the last row of the 3+4 day file in full', async () => {
    const read = readRows(await realSelection(MULTI));
    const byRow = new Map(read.rows.map((r) => [r.excelRow, r]));

    expect(byRow.get(2)).toStrictEqual({
      excelRow: 2,
      anchor: 'TB200X300A',
      data: {
        barcode: 'TB200X300A',
        stockCode: 'TB200X300A',
        productTitle: `200x300 Cm ${KUMAS} ${TURK_BAYRAGI}`,
        category: 'Bayrak',
        brand: 'Alpaka',
        stock: 875,
        currentPrice: '852',
        commissionBasePrice: '852',
        currentCommissionPct: '19',
        brackets: {
          band1Lower: '777.1',
          band2Lower: '753.24',
          band2Upper: '777.09',
          band3Lower: '720.78',
          band3Upper: '753.23',
          band4Upper: '720.77',
        },
        periodComms: [
          [null, null, null, null],
          ['19', '13.1', '12.1', '10.6'],
        ],
      },
    });
    expect(byRow.get(56)).toStrictEqual({
      excelRow: 56,
      anchor: '8694430000048',
      data: {
        barcode: '8694430000048',
        stockCode: '113111',
        productTitle: `200x300 ${TURK_BAYRAGI} ${EN_DASH} 1. Kalite ${KUMAS}`,
        category: 'Bayrak',
        brand: 'Buket',
        stock: 49,
        currentPrice: '900',
        commissionBasePrice: '900',
        currentCommissionPct: '19',
        brackets: {
          band1Lower: '777.28',
          band2Lower: '741.62',
          band2Upper: '777.27',
          band3Lower: '694.7',
          band3Upper: '741.61',
          band4Upper: '694.69',
        },
        periodComms: [
          [null, null, null, null],
          ['19', '15.4', '14', '11.9'],
        ],
      },
    });
  });

  it('maps the first row of the 7 day file in full', async () => {
    const read = readRows(await realSelection(SINGLE));

    expect(read.rows[0]).toStrictEqual({
      excelRow: 2,
      anchor: '2903004500010',
      data: {
        barcode: '2903004500010',
        stockCode: 'TBR-RAS-300x450',
        productTitle: `B${U_UMLAUT}y${U_UMLAUT}k Boy ${TURK_BAYRAGI} 300${TIMES}450 (3m x 4.5m) ${EN_DASH} ${RASEL} ${KUMAS}, Tok Duru${S_CEDILLA}, ${CIFT_DIKIS}`,
        category: 'Bayrak',
        brand: 'AKYILDIZ store',
        stock: 50,
        currentPrice: '1626',
        commissionBasePrice: '1544.7',
        currentCommissionPct: '19',
        brackets: {
          band1Lower: '1299.13',
          band2Lower: '1224.55',
          band2Upper: '1299.12',
          band3Lower: '1131.61',
          band3Upper: '1224.54',
          band4Upper: '1131.6',
        },
        periodComms: [['19', '18', '16.7', '14.8']],
      },
    });
  });

  // Both real files are Trendyol's own filled exports: eleven rows of the 3+4 day file
  // carry a 4-day tariff selection without a new price, and the 7 day file's first row
  // carries a new price and a 7-day selection. Prefilled rows are ignored, never refused.
  it('counts the rows the seller already filled in: eleven in the 3+4 day file, one in the 7 day file', async () => {
    const counts: number[] = [];
    const filled: unknown[] = [];
    for (const [file, cols] of [
      [MULTI, MULTI_COL],
      [SINGLE, COL],
    ] as const) {
      const selection = await realSelection(file);
      const read = readRows(selection);
      counts.push(
        countPrefilled(selection, read.rows, resolveWriteColumns(format, selection.layout)),
      );
      filled.push(
        selection.grid
          .slice(1)
          .map((row, index) => [
            index + 2,
            cellText(row, cols.newTsf),
            cellText(row, cols.tariffSelection),
          ])
          .filter(([, newTsf, selection]) => newTsf !== null || selection !== null),
      );
    }

    expect(counts).toEqual([11, 1]);
    expect(format.prefilled).toBe('ignore');
    const fourDays = `4 ${TARIFF_WINDOW_LABEL_UNIT}`;
    expect(filled).toEqual([
      [6, 17, 31, 33, 39, 40, 42, 44, 46, 52, 55].map((excelRow) => [excelRow, null, fourDays]),
      [[2, '1299.12', `7 ${TARIFF_WINDOW_LABEL_UNIT}`]],
    ]);
  });
});

describe('Trendyol commission tariff format: the row fallbacks', () => {
  it('reads the stock code from the model code, else the seller stock code, else null', () => {
    expect(mapOne().stockCode).toBe('MODEL-1');
    expect(mapOne({ [COL.modelCode]: null }).stockCode).toBe('SELLER-1');
    expect(mapOne({ [COL.modelCode]: null, [COL.sellerStockCode]: null }).stockCode).toBeNull();
  });

  it('reads a blank current price as null', () => {
    expect(mapOne({ [COL.currentPrice]: null }).currentPrice).toBeNull();
    expect(mapOne({ [COL.currentPrice]: '   ' }).currentPrice).toBeNull();
  });

  it('reads an unreadable current price text as null', () => {
    expect(mapOne({ [COL.currentPrice]: '249,90 TL' }).currentPrice).toBeNull();
  });

  // The grid reader turns an error cell into '#ERROR_' and its text; a typed '#REF!'
  // text reads the same way.
  it.each(['#REF!', '#ERROR_#REF!'])('reads an error cell (%s) as null', (cell) => {
    expect(mapOne({ [COL.currentPrice]: cell }).currentPrice).toBeNull();
  });

  it('reads a date or boolean current price cell as null', () => {
    expect(mapOne({ [COL.currentPrice]: new Date(Date.UTC(2026, 6, 1)) }).currentPrice).toBeNull();
    expect(mapOne({ [COL.currentPrice]: true }).currentPrice).toBeNull();
    expect(mapOne({ [COL.currentPrice]: false }).currentPrice).toBeNull();
  });

  // 0.004 is zero at the stored scale: it would store as 0.00.
  it.each([
    ['the number 0', 0],
    ['the text 0', '0'],
    ['the text 0,00', '0,00'],
    ['the number 0.004', 0.004],
  ])('reads a literal 0 current price (%s) as null', (_name, cell) => {
    expect(mapOne({ [COL.currentPrice]: cell }).currentPrice).toBeNull();
  });

  it("keeps a readable current price as the file's text", () => {
    expect(mapOne().currentPrice).toBe('540');
    expect(mapOne({ [COL.currentPrice]: 249.9 }).currentPrice).toBe('249.9');
    expect(mapOne({ [COL.currentPrice]: '249,90' }).currentPrice).toBe('249.90');
    // Not zero at the stored scale: it stores as 0.01.
    expect(mapOne({ [COL.currentPrice]: 0.005 }).currentPrice).toBe('0.005');
  });

  it.each([
    ['the number -5', -5],
    ['the text -0,01', '-0,01'],
  ])('still refuses a readable negative current price (%s)', (_name, cell) => {
    const err = captureThrow(() => mapOne({ [COL.currentPrice]: cell }));

    expect(err).toBeInstanceOf(SpreadsheetFileError);
    if (!(err instanceof SpreadsheetFileError)) return;
    expect(err.code).toBe('MALFORMED_SHEET');
    expect(err.meta).toEqual({ reason: UNWRITABLE_VALUE_REASON });
  });

  it('reads a blank current commission as null', () => {
    expect(mapOne({ [COL.currentCommission]: null }).currentCommissionPct).toBeNull();
    expect(mapOne({ [COL.currentCommission]: '   ' }).currentCommissionPct).toBeNull();
  });

  // The grid reader turns an error cell into '#ERROR_' and its text.
  it.each([
    ['a percent sign before the number', '%19'],
    ['a percent sign after the number', '19 %'],
    ['a lira suffix', '19 TL'],
    ['an error cell', '#ERROR_#REF!'],
    ['the boolean true', true],
    ['the boolean false', false],
  ])('reads an unreadable current commission (%s) as null', (_name, cell) => {
    expect(mapOne({ [COL.currentCommission]: cell }).currentCommissionPct).toBeNull();
  });

  // A readable 0 is a real 0% commission, kept as the file's text (never null).
  it.each([
    ['the number 0', 0, '0'],
    ['the text 0', '0', '0'],
    ['the text 0,00', '0,00', '0.00'],
  ])('keeps a literal 0 current commission (%s) as 0', (_name, cell, expected) => {
    expect(mapOne({ [COL.currentCommission]: cell }).currentCommissionPct).toBe(expected);
  });

  it("keeps a readable current commission as the file's text", () => {
    expect(mapOne().currentCommissionPct).toBe('19');
    expect(mapOne({ [COL.currentCommission]: 21.5 }).currentCommissionPct).toBe('21.5');
    expect(mapOne({ [COL.currentCommission]: '19,5' }).currentCommissionPct).toBe('19.5');
  });

  it('reads a literal 0 commission base price as null', () => {
    for (const cell of [0, '0', '0,00', 0.004]) {
      expect(mapOne({ [COL.commissionBasePrice]: cell }).commissionBasePrice).toBeNull();
    }
    expect(mapOne({ [COL.commissionBasePrice]: 0.005 }).commissionBasePrice).toBe('0.005');
  });

  it('does not refuse a row whose band has neither limit when the current price is unknown', () => {
    // Band 1 has no upper limit; without its lower limit it has no price at all.
    const row = mapOne({ [COL.currentPrice]: null, [COL.band1Lower]: null });

    expect(row.currentPrice).toBeNull();
    expect(row.brackets.band1Lower).toBeNull();
    expect(row.periodComms).toEqual([['19', '15.4', '12.1', '10.6']]);
  });

  it('still refuses an unwritable limit of another band when the current price is unknown', () => {
    const err = captureThrow(() =>
      mapOne({ [COL.currentPrice]: null, [COL.band1Lower]: null, [COL.band2Upper]: -5 }),
    );

    expect(err).toBeInstanceOf(SpreadsheetFileError);
    if (!(err instanceof SpreadsheetFileError)) return;
    expect(err.code).toBe('MALFORMED_SHEET');
    expect(err.meta).toEqual({ reason: UNWRITABLE_VALUE_REASON });
  });

  it('keeps a blank commission base price null, never the current price', () => {
    expect(mapOne().commissionBasePrice).toBe('520');
    expect(mapOne({ [COL.commissionBasePrice]: null }).commissionBasePrice).toBeNull();
  });

  it('reads the commission base price as null when the column is absent', () => {
    const header = SINGLE_HEADER.filter((_, col) => col !== COL.commissionBasePrice);
    const row = dataRow().filter((_, col) => col !== COL.commissionBasePrice);

    const read = readRows(gridSelection([[...header], row]));

    expect(read.rows[0]?.data.commissionBasePrice).toBeNull();
    expect(read.rows[0]?.data.currentPrice).toBe('540');
  });

  it('reads each price bracket from its own column', () => {
    expect(mapOne().brackets).toStrictEqual({
      band1Lower: '500.1',
      band2Lower: '450.2',
      band2Upper: '500.09',
      band3Lower: '400.3',
      band3Upper: '450.19',
      band4Upper: '400.29',
    });
  });

  it('reads a blank or unreadable bracket limit and period commission as null', () => {
    const row = mapOne({
      [COL.band2Upper]: null,
      [COL.band3Lower]: 'none',
      [COMM_COLS[2]]: null,
      [COMM_COLS[3]]: '15 TL',
    });

    expect(row.brackets.band2Upper).toBeNull();
    expect(row.brackets.band3Lower).toBeNull();
    expect(row.periodComms).toEqual([['19', '15.4', null, null]]);
  });

  it('falls back to the barcode for a blank title and reads blank optional columns as null', () => {
    expect(
      mapOne({
        [COL.productTitle]: null,
        [COL.category]: null,
        [COL.brand]: null,
        [COL.stock]: null,
      }),
    ).toMatchObject({ productTitle: 'BC-1', category: null, brand: null, stock: null });
  });

  it('decodes Excel escapes in display text and keeps the anchor raw', () => {
    const row = mapOne({
      [COL.barcode]: 'BC_x0041_1',
      [COL.productTitle]: 'Tisort_x000a_Pamuk',
      [COL.category]: 'Cat_x0041_',
      [COL.brand]: 'AB_x005F_x0041_',
      [COL.modelCode]: 'AB_x005F_x0041_',
    });

    expect(row).toMatchObject({
      barcode: 'BC_x0041_1',
      productTitle: 'Tisort\nPamuk',
      category: 'CatA',
      brand: 'AB_x0041_',
      stockCode: 'AB_x0041_',
    });
  });

  it('takes the decoded seller stock code when the model code decodes to nothing', () => {
    const row = mapOne({ [COL.modelCode]: '_x0020_', [COL.sellerStockCode]: 'S_x0041_' });

    expect(row.stockCode).toBe('SA');
  });

  it('titles a row by its raw barcode when its title decodes to nothing', () => {
    const row = mapOne({ [COL.barcode]: 'BC_x0041_1', [COL.productTitle]: '_x0020_' });

    expect(row.productTitle).toBe('BC_x0041_1');
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
      [COL.band4Upper]: '1.100',
      [COL.commissionBasePrice]: '350 TL',
      [COMM_COLS[1]]: '12,5',
    });

    expect([row.currentPrice, row.brackets.band4Upper, row.commissionBasePrice]).toEqual([
      '1234.56',
      '1.100',
      null,
    ]);
    expect(row.periodComms[0]?.[1]).toBe('12.5');
  });

  it('skips a row without a barcode, and keeps the sheet order of the rest', () => {
    const grid: SheetData = [
      [...SINGLE_HEADER],
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
});

describe('Trendyol commission tariff format: a value the export could not write', () => {
  // The first kept row of the 3+4 day file. Choosing a band without a custom price writes
  // the band's price into "YENI TSF"; a band missing from the stored bands, or one with
  // neither limit, writes the current price.
  const FIRST_KEPT_ROW = 2;

  function withCells(file: Buffer, patches: readonly Omit<CellPatch, 'excelRow'>[]): Buffer {
    return patchFixture(
      file,
      patches.map((patch) => ({ ...patch, excelRow: FIRST_KEPT_ROW })),
      { sheet: format.sheet },
    );
  }

  function number(col: number, value: string): Omit<CellPatch, 'excelRow'> {
    return { col, value: { kind: 'number', value } };
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

  // A negative current price, and one with eleven integer digits.
  it.each(['-5', '12345678901'])(
    'refuses a current price of %s with MALFORMED_SHEET unwritable-value',
    async (value) => {
      const file = withCells(MULTI, [number(MULTI_COL.currentPrice, value)]);
      const selection = await realSelection(file);
      expect(column(selection.layout, 'currentPrice')).toBe(MULTI_COL.currentPrice);

      await expectUnwritable(file, value);
    },
  );

  // Bands 1 and 2 have a commission in the 4-day block: band 2 is written at its upper
  // limit, band 1 (which has no upper limit) at its lower limit.
  it.each([
    ['band 2 upper limit', 'band2Upper', COL.band2Upper],
    ['band 1 lower limit', 'band1Lower', COL.band1Lower],
  ] as const)('refuses a negative %s whose band has a commission', async (_name, key, col) => {
    const file = withCells(MULTI, [number(col, '-5')]);
    const selection = await realSelection(file);
    expect(column(selection.layout, key)).toBe(col);

    await expectUnwritable(file, '-5');
  });

  it('keeps a negative band upper limit whose band has no commission in any block', async () => {
    // The same limit as above, but band 2's commission is blank in the 3-day block and
    // cleared in the 4-day block, so band 2 is never stored and its limit never written.
    const file = withCells(MULTI, [
      number(COL.band2Upper, '-5'),
      { col: MULTI_COMM_4[1], value: { kind: 'clear' } },
    ]);

    const read = readRows(await realSelection(file));

    expect(read.rows[0]?.excelRow).toBe(FIRST_KEPT_ROW);
    expect(read.rows[0]?.data.brackets.band2Upper).toBe('-5');
    expect(read.rows[0]?.data.periodComms).toEqual([
      [null, null, null, null],
      ['19', null, '12.1', '10.6'],
    ]);
    expect(read.rows.length).toBe(55);
  });

  it('keeps a current price as wide as the export writes', async () => {
    const read = readRows(
      await realSelection(withCells(MULTI, [number(MULTI_COL.currentPrice, '9999999999.99')])),
    );

    expect(read.rows[0]?.data.currentPrice).toBe('9999999999.99');
    expect(read.rows.length).toBe(55);
  });

  // The export writes a band price with two decimals, so an Excel float residue in a
  // limit is kept, and stored as the file's own text.
  it.each([
    ['449.99000000000001', '449.99'],
    ['449.99000000000007', '449.99000000000007'],
  ])('keeps a band limit of %s, stored as %s', async (value, stored) => {
    const read = readRows(await realSelection(withCells(MULTI, [number(COL.band2Upper, value)])));

    expect(read.rows[0]?.data.brackets.band2Upper).toBe(stored);
    expect(read.rows.length).toBe(55);
  });

  it('does not check a value the export never writes: the commission base price, the current commission and a band lower limit beside its upper limit', async () => {
    const read = readRows(
      await realSelection(
        withCells(MULTI, [
          number(MULTI_COL.commissionBasePrice, '12345678901'),
          number(MULTI_COL.currentCommission, '12345678901'),
          number(COL.band2Lower, '-5'),
        ]),
      ),
    );

    expect(read.rows[0]?.data.commissionBasePrice).toBe('12345678901');
    expect(read.rows[0]?.data.currentCommissionPct).toBe('12345678901');
    expect(read.rows[0]?.data.brackets.band2Lower).toBe('-5');
  });

  it('reads the 4-day block label and commissions of the first kept row', async () => {
    const { grid } = await realSelection(MULTI);

    expect(cellText(grid[1] ?? [], MULTI_LABEL_4)).toBe('26 Haziran 08.00-30 Haziran 07.59');
    expect(MULTI_COMM_4.map((col) => cellText(grid[1] ?? [], col))).toEqual([
      '19',
      '13.1',
      '12.1',
      '10.6',
    ]);
  });
});

describe('Trendyol commission tariff format: the import rehearsal on the real files', () => {
  async function rehearse(file: Buffer) {
    const selection = await realSelection(file);
    const read = readRows(selection);
    const resolved = resolveWriteColumns(format, selection.layout);
    return {
      selection,
      rehearsal: buildRehearsal(selection, rehearsalTargets('anchor-map', read), resolved),
    };
  }

  it('rehearses both write columns of every row of both files with their own formula columns', async () => {
    for (const [file, rows, columns] of [
      [MULTI, 55, [27, 30]],
      [SINGLE, 55, [22, 24]],
    ] as const) {
      const { rehearsal } = await rehearse(file);
      expect(rehearsal.overwriteFormulaColumns).toEqual(columns);
      expect(rehearsal.patches).toHaveLength(rows * columns.length);

      const patched = patchFixture(file, rehearsal.patches, {
        sheet: format.sheet,
        overwriteFormulaColumns: rehearsal.overwriteFormulaColumns,
      });
      expect(patched.equals(file)).toBe(false);
    }
  });

  it('inserts the write cells the 7 day file does not have yet', async () => {
    const { selection, rehearsal } = await rehearse(SINGLE);
    const sourceRows = selection.grid.slice(1);
    // Only the first data row (Trendyol's filled one) holds a new price and a selection.
    expect(sourceRows.filter((row) => cellText(row, COL.newTsf) === null)).toHaveLength(54);
    expect(sourceRows.filter((row) => cellText(row, COL.tariffSelection) === null)).toHaveLength(
      54,
    );

    const patched = patchFixture(SINGLE, rehearsal.patches, {
      sheet: format.sheet,
      overwriteFormulaColumns: rehearsal.overwriteFormulaColumns,
    });
    const grid = await readWorkbookGrid(patched, { sheet: format.sheet });

    const dataRows = grid.slice(1);
    expect(dataRows).toHaveLength(55);
    for (const row of dataRows) {
      expect(cellText(row, COL.newTsf)).toBe('9999999999.99');
      expect(cellText(row, COL.tariffSelection)).toBe(`7 ${TARIFF_WINDOW_LABEL_UNIT}`);
    }
  });
});

describe('Trendyol commission tariff format: the legacy golden digests', () => {
  it("reads both real files to the legacy parser's digests", async () => {
    const multi = readRows(await realSelection(MULTI));
    const single = readRows(await realSelection(SINGLE));

    expect(digest(multi)).toEqual(goldenDigest(MULTI_FILE, 'real'));
    expect(digest(single)).toEqual(goldenDigest(SINGLE_FILE, 'real'));
    expect([multi.rows.length, multi.skippedRows]).toEqual([55, 0]);
    expect([single.rows.length, single.skippedRows]).toEqual([55, 0]);
  });

  it("reads the derived rows to the legacy parser's digest, dropped and kept rows included", async () => {
    const fixture = (await realSelection(MULTI)).grid;
    const grid = derivedGrid(format.layout, format.keep, fixture, COMMISSION_DERIVED);
    const read = readRows(gridSelection(grid));
    const real = goldenDigest(MULTI_FILE, 'real');
    const derived = goldenDigest(MULTI_FILE, 'derived');
    const keptNames = COMMISSION_DERIVED.filter((testCase) => testCase.kept).map(
      (testCase) => testCase.name,
    );
    const keptCases = keptNames.length;
    // The kept derived rows follow the fixture's own kept rows, in case order.
    const derivedRow = (name: string): CommissionTariffRow => {
      const index = keptNames.indexOf(name);
      expect(index).toBeGreaterThanOrEqual(0);
      return present(read.rows[real.keptRows + index], name).data;
    };

    // An unknown current price reads as null: a blank cell, and a text that does not read.
    expect(derivedRow('a blank current price').currentPrice).toBeNull();
    expect(derivedRow('lira-suffixed prices and commission').currentPrice).toBeNull();
    // An unknown current commission reads as null, never as 0.
    expect(derivedRow('a blank current commission').currentCommissionPct).toBeNull();
    expect(digest(read)).toEqual(derived);
    // Every derived case lands on the side its `kept` flag names.
    expect(read.rows.length).toBe(real.keptRows + keptCases);
    expect(read.skippedRows).toBe(real.skippedRows + COMMISSION_DERIVED.length - keptCases);
    // The derived grid both drops and keeps rows, so its digest pins a row mapping and
    // not only a skipped count.
    expect(read.skippedRows).toBe(2);
    expect(read.rows.length).toBe(77);
    expect(derived.keptRows).toBeGreaterThan(real.keptRows);
    expect(derived.sha256).not.toBe(real.sha256);
  });
});
