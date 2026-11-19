// The Trendyol advantage tariff format on its own, with no legacy code: the header cases
// of the old resolver's test, three literal rows of the real file, the keep rule, the
// star tiers the import stores, the two yes flags, the cases of the advantage block of
// the layout parity test, a tier limit the export could not write, the permanent golden
// digests of tests/fixtures/workbook-golden/legacy-rows.json (written by the legacy
// import parser before it was deleted), the rows the real file already fills in, and the
// import rehearsal on the real file. A change to `mapRow` or the keep rule that alters
// any field of any row, on the real file or on its derived rows, fails here.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  cellDecimal,
  cellText,
  columnIndex,
  createRowReader,
  normalizeHeader,
  readWorkbookGrid,
  resolveLayout,
  SpreadsheetFileError,
  type CellValue,
  type SheetData,
} from '@pazarsync/spreadsheet';
import { patchFixture } from '@pazarsync/spreadsheet/testing';
import { businessZoneEpochToInstant } from '@pazarsync/utils';
import { describe, expect, it, vi } from 'vitest';

import { VALUE_OUT_OF_RANGE_REASON } from '@/workbooks/column-range';
import { FORMAT_SUMMARIES } from '@/workbooks/formats/registry';
import {
  buildStarTiers,
  trendyolAdvantageTariffFormat,
  type AdvantageTariffRow,
} from '@/workbooks/formats/trendyol/advantage-tariff.format';
import {
  APPLY_UNTIL_END_YES_FOLDED,
  NO_LABEL,
  TARIFF_FLAG_YES_FOLDED,
  TRENDYOL_FINGERPRINTS,
} from '@/workbooks/formats/trendyol/labels';
import { countPrefilled, readRows } from '@/workbooks/import-rows';
import { buildRehearsal, rehearsalTargets } from '@/workbooks/rehearsal';
import { selectFormat } from '@/workbooks/select-format';
import { resolveWriteColumns, UNWRITABLE_VALUE_REASON } from '@/workbooks/write-columns';

import { canonicalJson, sha256Hex } from '../../../helpers/canonical-json';
import { ADVANTAGE_DERIVED, derivedGrid } from '../../../helpers/workbook-derived-rows';

// The fixture is read through the parse worker, whose cold start can pass vitest's 5 s
// default under load.
vi.setConfig({ testTimeout: 60_000 });

const FIXTURE_FILE = 'trendyol-advantage-tariff.xlsx';
const FIXTURES_DIR = resolve(__dirname, '../../../fixtures');
const FIXTURE = readFileSync(resolve(FIXTURES_DIR, FIXTURE_FILE));
const GOLDEN_PATH = resolve(FIXTURES_DIR, 'workbook-golden/legacy-rows.json');
const READER_OPTIONS = { toInstant: businessZoneEpochToInstant };

const format = trendyolAdvantageTariffFormat;

// Turkish letters, by code point.
const U_UMLAUT_UPPER = String.fromCodePoint(0x00dc);
const U_UMLAUT = String.fromCodePoint(0x00fc);
const O_UMLAUT_UPPER = String.fromCodePoint(0x00d6);
const I_DOTTED_UPPER = String.fromCodePoint(0x0130);
const DOTLESS_I = String.fromCodePoint(0x0131);
const S_CEDILLA_UPPER = String.fromCodePoint(0x015e);
const S_CEDILLA = String.fromCodePoint(0x015f);
const G_BREVE_UPPER = String.fromCodePoint(0x011e);
const G_BREVE = String.fromCodePoint(0x011f);

const FIYAT = `F${I_DOTTED_UPPER}YAT`;
const KUMAS = `Kuma${S_CEDILLA}`;
const TURK_BAYRAGI = `T${U_UMLAUT}rk Bayra${G_BREVE}${DOTLESS_I}`;
const TIER3_UPPER_HEADER = `3 YILDIZ ${U_UMLAUT_UPPER}ST ${FIYAT}`;
const NEW_TSF_HEADER = `YEN${I_DOTTED_UPPER} TSF (${FIYAT} G${U_UMLAUT_UPPER}NCELLE)`;
const APPLY_UNTIL_END_HEADER = 'Tarife Sonuna Kadar Uygula';

// The real Trendyol header, as the legacy resolver's test held it.
const FULL_HEADER: readonly string[] = [
  `${U_UMLAUT_UPPER}R${U_UMLAUT_UPPER}N ${I_DOTTED_UPPER}SM${I_DOTTED_UPPER}`,
  'BARKOD',
  'BEDEN',
  'MODEL KODU',
  `KATEGOR${I_DOTTED_UPPER}`,
  'MARKA',
  'STOK',
  `KOM${I_DOTTED_UPPER}SYON TAR${I_DOTTED_UPPER}FES${I_DOTTED_UPPER}`,
  `1 YILDIZ ${U_UMLAUT_UPPER}ST ${FIYAT}`,
  `1 YILDIZ ALT ${FIYAT}`,
  `2 YILDIZ ${U_UMLAUT_UPPER}ST ${FIYAT}`,
  `2 YILDIZ ALT ${FIYAT}`,
  TIER3_UPPER_HEADER,
  `M${U_UMLAUT_UPPER}${S_CEDILLA_UPPER}TER${I_DOTTED_UPPER}N${I_DOTTED_UPPER}N G${O_UMLAUT_UPPER}RD${U_UMLAUT_UPPER}${G_BREVE_UPPER}${U_UMLAUT_UPPER} ${FIYAT}`,
  `TRENDYOL SATI${S_CEDILLA_UPPER} ${FIYAT}I`,
  NEW_TSF_HEADER,
  APPLY_UNTIL_END_HEADER,
  'EXTERNAL ID',
  `TAR${I_DOTTED_UPPER}FE GRUBU`,
];

// Column indices of FULL_HEADER (the legacy resolver's test held the same numbers).
const COL = {
  productTitle: 0,
  barcode: 1,
  size: 2,
  modelCode: 3,
  category: 4,
  brand: 5,
  stock: 6,
  commissionTariffFlag: 7,
  tier1Upper: 8,
  tier1Lower: 9,
  tier2Upper: 10,
  tier2Lower: 11,
  tier3Upper: 12,
  customerPrice: 13,
  currentPrice: 14,
  newTsf: 15,
  applyUntilEnd: 16,
  externalId: 17,
  tariffGroup: 18,
} as const;

const REQUIRED_KEYS = [
  'barcode',
  'currentPrice',
  'tier1Upper',
  'tier1Lower',
  'tier2Upper',
  'tier2Lower',
  'tier3Upper',
] as const;

// A synthetic data row every literal case starts from: three tiers with both limits.
const BASE_ROW: Readonly<Record<number, CellValue>> = {
  [COL.productTitle]: 'Product',
  [COL.barcode]: 'BC-1',
  [COL.modelCode]: 'MODEL-1',
  [COL.category]: 'Bayrak',
  [COL.brand]: 'Brand',
  [COL.stock]: 18,
  [COL.commissionTariffFlag]: 'Var',
  [COL.tier1Upper]: '292,91',
  [COL.tier1Lower]: '274,43',
  [COL.tier2Upper]: '274,42',
  [COL.tier2Lower]: '223,79',
  [COL.tier3Upper]: '223,78',
  [COL.customerPrice]: '350,00',
  [COL.currentPrice]: '360,00',
  [COL.applyUntilEnd]: NO_LABEL,
  [COL.tariffGroup]: 'group-1',
};

/** A data row under FULL_HEADER: BASE_ROW with `overrides` written over it (null blanks a cell). */
function dataRow(overrides: Readonly<Record<number, CellValue>> = {}): CellValue[] {
  return FULL_HEADER.map((_, col) => {
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
function mapOne(overrides: Readonly<Record<number, CellValue>> = {}): AdvantageTariffRow {
  const read = readRows(gridSelection([[...FULL_HEADER], dataRow(overrides)]));
  return present(read.rows[0], 'kept row').data;
}

/** The star tiers `buildStarTiers` reads from one synthetic data row. */
function tiersOf(overrides: Readonly<Record<number, CellValue>>) {
  const layout = present(headerLayout(FULL_HEADER), 'layout');
  return buildStarTiers(createRowReader(format.layout, layout, dataRow(overrides), READER_OPTIONS));
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

describe('Trendyol advantage tariff format: headers', () => {
  it('is the header row of the real fixture', async () => {
    const selection = await realSelection();

    expect(selection.grid[0]).toEqual(FULL_HEADER);
  });

  it('is recognised by its fingerprint headers', () => {
    expect(format.fingerprint).toEqual(TRENDYOL_FINGERPRINTS.ADVANTAGE_TARIFF);
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

  it('resolves the one write-back column, the new sale price', () => {
    const layout = present(headerLayout(FULL_HEADER), 'layout');

    expect(resolveWriteColumns(format, layout).map((entry) => [entry.key, entry.col])).toEqual([
      ['newTsf', COL.newTsf],
    ]);
  });

  it('survives a column reorder (header-name resolution)', () => {
    const reversed = [...FULL_HEADER].reverse();
    const layout = present(headerLayout(reversed), 'layout');

    const barcode = present(columnIndex(format.layout, layout, 'barcode'), 'barcode column');
    const newTsf = present(columnIndex(format.layout, layout, 'newTsf'), 'new price column');
    expect(reversed[barcode]).toBe('BARKOD');
    expect(reversed[newTsf]).toBe(NEW_TSF_HEADER);
  });

  it('does not resolve without the barcode column', () => {
    expect(headerLayout(FULL_HEADER.filter((h) => h !== 'BARKOD'))).toBeNull();
  });

  it('does not resolve without a star threshold column', () => {
    expect(headerLayout(FULL_HEADER.filter((h) => h !== TIER3_UPPER_HEADER))).toBeNull();
  });

  it('does not resolve a header that is not the advantage header', () => {
    expect(headerLayout(['not', 'an', 'advantage', 'header'])).toBeNull();
  });

  it.each(REQUIRED_KEYS)('does not resolve without the required column %s', (key) => {
    expect(headerLayout(FULL_HEADER.filter((_, col) => col !== COL[key]))).toBeNull();
  });

  it('resolves without any optional column, and then has no write-back column', () => {
    const required = new Set<number>(REQUIRED_KEYS.map((key) => COL[key]));
    const layout = present(
      headerLayout(FULL_HEADER.filter((_, col) => required.has(col))),
      'layout',
    );

    expect(resolveWriteColumns(format, layout)).toEqual([]);
  });
});

describe('Trendyol advantage tariff format: rows of the real file', () => {
  it('maps the first row, a row applied until the end of the tariff and the last row in full', async () => {
    const read = readRows(await realSelection());
    const byRow = new Map(read.rows.map((r) => [r.excelRow, r]));

    expect(byRow.get(2)).toStrictEqual({
      excelRow: 2,
      anchor: 'TB100X150A',
      data: {
        barcode: 'TB100X150A',
        stockCode: 'TB100X150A',
        productTitle: `100x150 Cm ${KUMAS} ${TURK_BAYRAGI}`,
        category: 'Bayrak',
        brand: 'Alpaka',
        size: null,
        modelCode: 'TB100X150A',
        stock: 89,
        currentPrice: '360.00',
        customerPrice: '360.00',
        hasCommissionTariff: true,
        starTiers: [
          { key: 'tier1', upperLimit: '292.91', lowerLimit: '274.43' },
          { key: 'tier2', upperLimit: '274.42', lowerLimit: '223.79' },
          { key: 'tier3', upperLimit: '223.78' },
        ],
        applyUntilEnd: false,
        externalId: null,
        tariffGroup: '7e67ad8f35ee0a3924550800d831a2d1',
      },
    });
    expect(byRow.get(10)).toStrictEqual({
      excelRow: 10,
      anchor: 'TB120X180A',
      data: {
        barcode: 'TB120X180A',
        stockCode: 'TB120X180A',
        productTitle: `120x180 Cm ${KUMAS} ${TURK_BAYRAGI}`,
        category: 'Bayrak',
        brand: 'Alpaka',
        size: null,
        modelCode: 'TB120X180A',
        stock: 87,
        currentPrice: '440.00',
        customerPrice: '418.41',
        hasCommissionTariff: true,
        starTiers: [
          { key: 'tier1', upperLimit: '415.73', lowerLimit: '405.15' },
          { key: 'tier2', upperLimit: '405.14', lowerLimit: '381.09' },
          { key: 'tier3', upperLimit: '381.08' },
        ],
        applyUntilEnd: true,
        externalId: 'rh_ac248ac99af2fda5553c919c71679fd2',
        tariffGroup: '7e67ad8f35ee0a3924550800d831a2d1',
      },
    });
    expect(byRow.get(72)).toStrictEqual({
      excelRow: 72,
      anchor: '8694430701051',
      data: {
        barcode: '8694430701051',
        stockCode: 'PRA-177361-7830',
        productTitle: `Bkt-106 70x105 Cm ${TURK_BAYRAGI}`,
        category: 'Bayrak',
        brand: 'Buket',
        size: null,
        modelCode: 'PRA-177361-7830',
        stock: 991,
        currentPrice: '250.00',
        customerPrice: '250.00',
        hasCommissionTariff: true,
        starTiers: [
          { key: 'tier1', upperLimit: '148.08', lowerLimit: '129.07' },
          { key: 'tier2', upperLimit: '129.06', lowerLimit: '98.83' },
          { key: 'tier3', upperLimit: '98.82' },
        ],
        applyUntilEnd: false,
        externalId: null,
        tariffGroup: '7e67ad8f35ee0a3924550800d831a2d1',
      },
    });
  });

  it('marks the rows whose commission tariff flag is set and the rows applied until the end', async () => {
    const read = readRows(await realSelection());

    // Counted in the sheet XML: 55 cells read Var and 16 Yok; 6 read Evet.
    expect(read.rows.filter((row) => row.data.hasCommissionTariff)).toHaveLength(55);
    expect(read.rows.filter((row) => row.data.applyUntilEnd)).toHaveLength(6);
  });

  it('finds no row the seller already filled in', async () => {
    const selection = await realSelection();
    const read = readRows(selection);
    const resolved = resolveWriteColumns(format, selection.layout);

    expect(countPrefilled(selection, read.rows, resolved)).toBe(0);
  });
});

describe('Trendyol advantage tariff format: the keep rule and row order', () => {
  // Ported from the layout parity test: a barcode alone does not keep a row.
  it('does not keep a row with a barcode but no current price', () => {
    const withoutPrice = FULL_HEADER.map((h) => (h === 'BARKOD' ? '8690000000001' : null));
    const withPrice = FULL_HEADER.map((_, col) => {
      if (col === COL.barcode) return '8690000000001';
      return col === COL.currentPrice ? 250 : null;
    });

    const read = readRows(gridSelection([[...FULL_HEADER], withoutPrice, withPrice]));

    expect(read.skippedRows).toBe(1);
    expect(read.rows.map((row) => row.excelRow)).toEqual([3]);
    expect(read.rows[0]?.data).toStrictEqual({
      barcode: '8690000000001',
      stockCode: null,
      productTitle: '8690000000001',
      category: null,
      brand: null,
      size: null,
      modelCode: null,
      stock: null,
      currentPrice: '250',
      customerPrice: '250',
      hasCommissionTariff: false,
      starTiers: [],
      applyUntilEnd: false,
      externalId: null,
      tariffGroup: null,
    });
  });

  it('skips a row without a barcode or a current price', () => {
    const grid: SheetData = [
      [...FULL_HEADER],
      dataRow({ [COL.barcode]: null }),
      dataRow({ [COL.barcode]: 'BC-2', [COL.currentPrice]: null }),
      dataRow({ [COL.barcode]: 'BC-3', [COL.currentPrice]: '360 TL' }),
      dataRow({ [COL.barcode]: 'BC-4' }),
    ];

    const read = readRows(gridSelection(grid));

    expect(read.rows.map((row) => row.anchor)).toEqual(['BC-4']);
    expect(read.skippedRows).toBe(3);
  });

  it('keeps the sheet order of the rows', () => {
    // Neither ascending nor descending, so an added sort or reverse shows.
    const grid: SheetData = [
      [...FULL_HEADER],
      dataRow({ [COL.barcode]: 'B-002' }),
      dataRow({ [COL.barcode]: 'C-003' }),
      dataRow({ [COL.barcode]: 'A-001' }),
    ];

    const read = readRows(gridSelection(grid));

    expect(read.rows.map((row) => row.anchor)).toEqual(['B-002', 'C-003', 'A-001']);
  });

  // Ported from the layout parity test: dropping the optional column changes nothing
  // else of any row.
  it('reads the same fields when the optional apply-until-end flag column is absent', async () => {
    const selection = await realSelection();
    const dropAt = (selection.grid[0] ?? []).findIndex(
      (cell) => normalizeHeader(cell) === APPLY_UNTIL_END_HEADER,
    );
    expect(dropAt).toBe(COL.applyUntilEnd);
    const withoutFlag = selection.grid.map((row) => row.filter((_, index) => index !== dropAt));

    const full = readRows(selection);
    const read = readRows(gridSelection(withoutFlag));

    expect(full.rows.some((row) => row.data.applyUntilEnd)).toBe(true);
    expect(read.skippedRows).toBe(full.skippedRows);
    expect(read.rows.map((row) => row.data)).toStrictEqual(
      full.rows.map((row) => ({ ...row.data, applyUntilEnd: false })),
    );
  });
});

describe('Trendyol advantage tariff format: the star tiers the import stores', () => {
  it('stores three tiers with both limits as three entries, tier 3 without a lower limit', () => {
    expect(tiersOf({})).toStrictEqual([
      { key: 'tier1', upperLimit: '292.91', lowerLimit: '274.43' },
      { key: 'tier2', upperLimit: '274.42', lowerLimit: '223.79' },
      { key: 'tier3', upperLimit: '223.78' },
    ]);
  });

  it('skips a tier without an upper limit and keeps the row', () => {
    expect(tiersOf({ [COL.tier2Upper]: null })).toStrictEqual([
      { key: 'tier1', upperLimit: '292.91', lowerLimit: '274.43' },
      { key: 'tier3', upperLimit: '223.78' },
    ]);
    expect(mapOne({ [COL.tier2Upper]: null }).barcode).toBe('BC-1');
  });

  it('stores a tier with an upper but no lower limit without the lowerLimit key', () => {
    const tiers = tiersOf({ [COL.tier1Lower]: null, [COL.tier2Lower]: 'none' });

    expect(tiers).toStrictEqual([
      { key: 'tier1', upperLimit: '292.91' },
      { key: 'tier2', upperLimit: '274.42' },
      { key: 'tier3', upperLimit: '223.78' },
    ]);
    for (const tier of tiers) expect(Object.hasOwn(tier, 'lowerLimit')).toBe(false);
  });

  it('stores no tier at all as an empty list', () => {
    expect(
      tiersOf({ [COL.tier1Upper]: null, [COL.tier2Upper]: null, [COL.tier3Upper]: null }),
    ).toStrictEqual([]);
  });

  it('keeps each limit as the plain grammar reads it, without rounding', () => {
    expect(
      tiersOf({
        [COL.tier1Upper]: 350,
        [COL.tier1Lower]: 300.5,
        [COL.tier2Upper]: '1.199,99',
        [COL.tier3Upper]: '1.250',
      }),
    ).toStrictEqual([
      { key: 'tier1', upperLimit: '350', lowerLimit: '300.5' },
      { key: 'tier2', upperLimit: '1199.99', lowerLimit: '223.79' },
      { key: 'tier3', upperLimit: '1.250' },
    ]);
  });

  it('skips a tier whose upper limit carries a lira suffix', () => {
    expect(tiersOf({ [COL.tier1Upper]: '292 TL' }).map((tier) => tier.key)).toEqual([
      'tier2',
      'tier3',
    ]);
  });
});

describe('Trendyol advantage tariff format: the row fallbacks and flags', () => {
  it.each([
    ['VAR', true],
    ['var', true],
    ['Var', true],
    [TARIFF_FLAG_YES_FOLDED, true],
    ['Yok', false],
    ['Evet', false],
    [null, false],
  ])('reads the commission tariff flag %s as %s (Turkish case folding)', (flag, expected) => {
    expect(mapOne({ [COL.commissionTariffFlag]: flag }).hasCommissionTariff).toBe(expected);
  });

  it.each([
    ['EVET', true],
    ['evet', true],
    ['Evet', true],
    [APPLY_UNTIL_END_YES_FOLDED, true],
    [NO_LABEL, false],
    ['Var', false],
    [null, false],
  ])('reads the apply-until-end flag %s as %s (Turkish case folding)', (flag, expected) => {
    expect(mapOne({ [COL.applyUntilEnd]: flag }).applyUntilEnd).toBe(expected);
  });

  it('falls back to the current price for a blank or unreadable customer price', () => {
    expect(mapOne().customerPrice).toBe('350.00');
    expect(mapOne({ [COL.customerPrice]: null }).customerPrice).toBe('360.00');
    expect(mapOne({ [COL.customerPrice]: '350 TL' }).customerPrice).toBe('360.00');
  });

  it('reads the prices as the plain grammar does, without rounding', () => {
    const row = mapOne({ [COL.currentPrice]: 399.9, [COL.customerPrice]: '1.234,56' });

    expect([row.currentPrice, row.customerPrice]).toEqual(['399.9', '1234.56']);
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

  it('stores the model code as the stock code too', () => {
    expect(mapOne()).toMatchObject({ stockCode: 'MODEL-1', modelCode: 'MODEL-1' });
    expect(mapOne({ [COL.modelCode]: null })).toMatchObject({ stockCode: null, modelCode: null });
  });

  it('reads every optional column as absent on a sheet of the required columns only', () => {
    const required = new Set<number>(REQUIRED_KEYS.map((key) => COL[key]));
    const header = FULL_HEADER.filter((_, col) => required.has(col));
    const row = dataRow().filter((_, col) => required.has(col));

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
      currentPrice: '360.00',
      customerPrice: '360.00',
      hasCommissionTariff: false,
      starTiers: [
        { key: 'tier1', upperLimit: '292.91', lowerLimit: '274.43' },
        { key: 'tier2', upperLimit: '274.42', lowerLimit: '223.79' },
        { key: 'tier3', upperLimit: '223.78' },
      ],
      applyUntilEnd: false,
      externalId: null,
      tariffGroup: null,
    });
  });

  it('falls back to the barcode for a blank title and reads blank optional columns as null', () => {
    const row = mapOne({
      [COL.productTitle]: null,
      [COL.category]: null,
      [COL.brand]: null,
      [COL.size]: null,
      [COL.externalId]: null,
      [COL.tariffGroup]: null,
    });

    expect(row).toMatchObject({
      productTitle: 'BC-1',
      category: null,
      brand: null,
      size: null,
      externalId: null,
      tariffGroup: null,
    });
  });

  it('decodes Excel escapes in display text and keeps the anchor and identifiers raw', () => {
    const row = mapOne({
      [COL.barcode]: 'BC_x0041_1',
      [COL.productTitle]: 'Tisort_x000a_Pamuk',
      [COL.category]: 'Cat_x0041_',
      [COL.brand]: 'AB_x005F_x0041_',
      [COL.size]: 'M_x0020_',
      [COL.modelCode]: 'AB_x005F_x0041_',
      [COL.externalId]: 'ID_x0041_',
      [COL.tariffGroup]: 'G_x0041_',
    });

    expect(row).toMatchObject({
      barcode: 'BC_x0041_1',
      productTitle: 'Tisort\nPamuk',
      category: 'CatA',
      brand: 'AB_x0041_',
      size: 'M',
      modelCode: 'AB_x0041_',
      stockCode: 'AB_x0041_',
      externalId: 'ID_x0041_',
      tariffGroup: 'G_x0041_',
    });
  });

  it('titles a row by its raw barcode when its title decodes to nothing', () => {
    const row = mapOne({ [COL.barcode]: 'BC_x0041_1', [COL.productTitle]: '_x0020_' });

    expect(row.productTitle).toBe('BC_x0041_1');
  });
});

describe('Trendyol advantage tariff format: a tier limit the export could not write', () => {
  // The first kept row of the real file and its tier 1 upper limit column (column I, as
  // the header case above resolves it). Choosing tier 1 writes this limit as the new
  // sale price.
  const FIRST_KEPT_ROW = 2;

  function withCell(key: keyof typeof COL, value: string): Buffer {
    return patchFixture(
      FIXTURE,
      [{ excelRow: FIRST_KEPT_ROW, col: COL[key], value: { kind: 'number', value } }],
      { sheet: format.sheet },
    );
  }

  // A negative limit, and one with eleven integer digits.
  it.each(['-5', '12345678901'])(
    'refuses a tier 1 upper limit of %s with MALFORMED_SHEET unwritable-value',
    async (value) => {
      const selection = await realSelection(withCell('tier1Upper', value));
      expect(columnIndex(format.layout, selection.layout, 'tier1Upper')).toBe(COL.tier1Upper);

      const err = captureThrow(() => readRows(selection));

      expect(err).toBeInstanceOf(SpreadsheetFileError);
      if (!(err instanceof SpreadsheetFileError)) return;
      expect(err.code).toBe('MALFORMED_SHEET');
      expect(err.meta).toEqual({ reason: UNWRITABLE_VALUE_REASON });
      expect(err.message).not.toContain(value);
    },
  );

  it('keeps a tier upper limit as wide as the export writes', async () => {
    const read = readRows(await realSelection(withCell('tier1Upper', '9999999999.99')));

    expect(read.rows[0]?.excelRow).toBe(FIRST_KEPT_ROW);
    expect(read.rows[0]?.data.starTiers[0]).toStrictEqual({
      key: 'tier1',
      upperLimit: '9999999999.99',
      lowerLimit: '274.43',
    });
    expect(read.rows.length).toBe(71);
  });

  it('does not check a value the export never writes: a lower limit or the current price', async () => {
    const lower = readRows(await realSelection(withCell('tier1Lower', '-5')));
    const current = readRows(await realSelection(withCell('currentPrice', '12345678901')));

    expect(lower.rows[0]?.data.starTiers[0]).toStrictEqual({
      key: 'tier1',
      upperLimit: '292.91',
      lowerLimit: '-5',
    });
    expect(current.rows[0]?.data.currentPrice).toBe('12345678901');
  });
});

describe('Trendyol advantage tariff format: the import rehearsal on the real file', () => {
  it('rehearses a row with a barcode and no current price: not kept, but a target row', async () => {
    // Row 3 loses its current price, so the keep rule drops it; its barcode still
    // matches an item, so the export may patch it.
    const ROW_WITHOUT_PRICE = 3;
    const file = patchFixture(
      FIXTURE,
      [{ excelRow: ROW_WITHOUT_PRICE, col: COL.currentPrice, value: { kind: 'clear' } }],
      { sheet: format.sheet },
    );
    const selection = await realSelection(file);
    const read = readRows(selection);
    const resolved = resolveWriteColumns(format, selection.layout);

    const targets = rehearsalTargets('anchor-map', read);
    const rehearsal = buildRehearsal(selection, targets, resolved);

    expect(read.skippedRows).toBe(1);
    expect(read.rows.map((row) => row.excelRow)).not.toContain(ROW_WITHOUT_PRICE);
    expect(targets).toContainEqual({ excelRow: ROW_WITHOUT_PRICE, anchor: 'TB50X75A' });
    expect(targets).toHaveLength(read.rows.length + 1);
    expect(rehearsal.patches).toContainEqual({
      excelRow: ROW_WITHOUT_PRICE,
      col: COL.newTsf,
      value: { kind: 'number', value: '9999999999.99', scale: 2 },
    });
    expect(rehearsal.patches).toHaveLength(targets.length);

    const patched = patchFixture(file, rehearsal.patches, {
      sheet: format.sheet,
      overwriteFormulaColumns: rehearsal.overwriteFormulaColumns,
    });
    const grid = await readWorkbookGrid(patched, { sheet: format.sheet });
    for (const target of targets) {
      const cells = grid[target.excelRow - 1] ?? [];
      expect(cellText(cells, COL.barcode)).toBe(target.anchor);
      expect(cellDecimal(cells, COL.newTsf, 'plain')).toBe('9999999999.99');
    }
  });
});

describe('Trendyol advantage tariff format: the legacy golden digests', () => {
  it("reads the real file to the legacy parser's digest", async () => {
    const read = readRows(await realSelection());

    expect(digest(read)).toEqual(goldenEntry(FIXTURE_FILE).real);
    expect(read.rows.length).toBe(71);
    expect(read.skippedRows).toBe(0);
  });

  it("reads the derived rows to the legacy parser's digest, dropped and kept rows included", async () => {
    const fixture = (await realSelection()).grid;
    const grid = derivedGrid(format.layout, format.keep, fixture, ADVANTAGE_DERIVED);
    const read = readRows(gridSelection(grid));
    const { real, derived } = goldenEntry(FIXTURE_FILE);
    const keptCases = ADVANTAGE_DERIVED.filter((testCase) => testCase.kept).length;

    expect(digest(read)).toEqual(derived);
    // Every derived case lands on the side its `kept` flag names.
    expect(read.rows.length).toBe(real.keptRows + keptCases);
    expect(read.skippedRows).toBe(real.skippedRows + ADVANTAGE_DERIVED.length - keptCases);
    // The derived grid both drops and keeps rows, so its digest pins a row mapping and
    // not only a skipped count.
    expect(read.skippedRows).toBe(3);
    expect(read.rows.length).toBe(91);
    expect(derived.skippedRows).toBeGreaterThan(0);
    expect(derived.keptRows).toBeGreaterThan(real.keptRows);
    expect(derived.sha256).not.toBe(real.sha256);
  });
});
