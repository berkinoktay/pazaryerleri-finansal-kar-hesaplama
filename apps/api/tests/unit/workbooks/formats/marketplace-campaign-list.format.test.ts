// The Trendyol marketplace campaign format on its own, with no legacy code: the header
// cases of the old resolver's test, three literal rows of the real file, the keep rule
// and row order cases of the old import test, the permanent golden digests of
// tests/fixtures/workbook-golden/legacy-rows.json (written by the legacy import parser
// before it was deleted), the rows the real file already fills in, and the lira-text
// case of the layout parity test. A change to `mapRow` or the keep rule that alters any
// field of any row, on the real file or on its derived rows, fails here.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  cellDecimal,
  columnIndex,
  createRowReader,
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
  CAMPAIGN_TARIFF_FLAG_YES,
  TRENDYOL_FINGERPRINTS,
} from '@/workbooks/formats/trendyol/labels';
import { trendyolMarketplaceCampaignListFormat } from '@/workbooks/formats/trendyol/marketplace-campaign-list.format';
import { countPrefilled, readRows } from '@/workbooks/import-rows';
import { selectFormat } from '@/workbooks/select-format';
import { resolveWriteColumns, UNWRITABLE_VALUE_REASON } from '@/workbooks/write-columns';

import { canonicalJson, sha256Hex } from '../../../helpers/canonical-json';
import {
  CAMPAIGN_DERIVED,
  CAMPAIGN_LIRA_TEXT,
  derivedGrid,
} from '../../../helpers/workbook-derived-rows';

// The fixture is read through the parse worker, whose cold start can pass vitest's 5 s
// default under load.
vi.setConfig({ testTimeout: 60_000 });

const FIXTURE_FILE = 'marketplace-campaign-sample.xlsx';
const FIXTURES_DIR = resolve(__dirname, '../../../fixtures');
const FIXTURE = readFileSync(resolve(FIXTURES_DIR, FIXTURE_FILE));
const GOLDEN_PATH = resolve(FIXTURES_DIR, 'workbook-golden/legacy-rows.json');
const READER_OPTIONS = { toInstant: businessZoneEpochToInstant };

const format = trendyolMarketplaceCampaignListFormat;

// Turkish letters and marks, by code point.
const U_UMLAUT_UPPER = String.fromCodePoint(0x00dc);
const U_UMLAUT = String.fromCodePoint(0x00fc);
const DOTLESS_I = String.fromCodePoint(0x0131);
const S_CEDILLA = String.fromCodePoint(0x015f);
const G_BREVE = String.fromCodePoint(0x011f);
const EN_DASH = String.fromCodePoint(0x2013);
const TIMES = String.fromCodePoint(0x00d7);

const URUN = `${U_UMLAUT_UPPER}r${U_UMLAUT}n`;
const SATIS_FIYATI = `Sat${DOTLESS_I}${S_CEDILLA} Fiyat${DOTLESS_I}`;
const CAMPAIGN_PRICE_HEADER = `Kampanyal${DOTLESS_I} ${SATIS_FIYATI}`;
const TURK_BAYRAGI = `T${U_UMLAUT}rk Bayra${G_BREVE}${DOTLESS_I}`;
const KUMAS = `Kuma${S_CEDILLA}`;

// The real Trendyol header, as the legacy resolver's test held it.
const FULL_HEADER: readonly string[] = [
  'Barkod',
  `${URUN} Ad${DOTLESS_I}`,
  `${URUN} Kodu`,
  'Kategori',
  'Marka',
  'Renk',
  'Beden',
  'Stok Kodu',
  'Mevcut Stok',
  `Mevcut ${SATIS_FIYATI}`,
  `Maksimum Girebilece${G_BREVE}in Fiyat`,
  CAMPAIGN_PRICE_HEADER,
  `${URUN} Komisyon Tarifesi`,
  'ListingId',
];

// The real Trendyol discount header: the campaign layout must not resolve it.
const DISCOUNT_HEADER: readonly string[] = [
  `Trendyol ${URUN} ID`,
  `${URUN} Bilgisi`,
  'Marka',
  'Renk',
  'Barkod',
  'Model Kodu',
  `G${U_UMLAUT}ncel ${SATIS_FIYATI}`,
  'Buybox',
  'Kampayaya Dahil Edilsin Mi?',
];

/** A data row under FULL_HEADER, every cell blank but the ones given by column index. */
function dataRow(cells: Readonly<Record<number, CellValue>>): CellValue[] {
  return FULL_HEADER.map((_, col) => cells[col] ?? null);
}

function headerLayout(header: readonly string[]) {
  return resolveLayout(format.layout, [[...header]]);
}

function present<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`${what} is missing`);
  return value;
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

function gridSelection(grid: SheetData) {
  return { format, grid, layout: present(resolveLayout(format.layout, grid), 'layout') };
}

describe('Trendyol marketplace campaign format: headers', () => {
  it('is the header row of the real fixture', async () => {
    const selection = await realSelection();

    expect(selection.grid[0]).toEqual(FULL_HEADER);
  });

  it('is recognised by its fingerprint headers', () => {
    expect(format.fingerprint).toEqual(TRENDYOL_FINGERPRINTS.MARKETPLACE_CAMPAIGN_LIST);
    for (const name of format.fingerprint) expect(FULL_HEADER).toContain(name);
  });

  it('resolves every column of the real Trendyol header', () => {
    const layout = present(headerLayout(FULL_HEADER), 'layout');

    expect(columnIndex(format.layout, layout, 'barcode')).toBe(0);
    expect(columnIndex(format.layout, layout, 'currentPrice')).toBe(9);
    expect(columnIndex(format.layout, layout, 'maxPrice')).toBe(10);
    expect(columnIndex(format.layout, layout, 'campaignPrice')).toBe(11);
    expect(columnIndex(format.layout, layout, 'commissionTariffFlag')).toBe(12);
    expect(columnIndex(format.layout, layout, 'externalId')).toBe(13);
  });

  it('survives a column reorder (header-name resolution)', () => {
    const reversed = [...FULL_HEADER].reverse();
    const layout = present(headerLayout(reversed), 'layout');

    const barcode = present(columnIndex(format.layout, layout, 'barcode'), 'barcode column');
    const price = present(columnIndex(format.layout, layout, 'campaignPrice'), 'price column');
    expect(reversed[barcode]).toBe('Barkod');
    expect(reversed[price]).toBe(CAMPAIGN_PRICE_HEADER);
  });

  it.each(FULL_HEADER)('does not resolve when the required header "%s" is missing', (missing) => {
    expect(headerLayout(FULL_HEADER.filter((h) => h !== missing))).toBeNull();
  });

  it('does not resolve the discount file header', () => {
    expect(headerLayout(DISCOUNT_HEADER)).toBeNull();
  });
});

describe('Trendyol marketplace campaign format: rows of the real file', () => {
  it('maps the first row, a row with a commission tariff and the last row in full', async () => {
    const read = readRows(await realSelection());
    const byBarcode = new Map(read.rows.map((r) => [r.anchor, r]));

    expect(byBarcode.get('211537788423')).toStrictEqual({
      excelRow: 2,
      anchor: '211537788423',
      data: {
        barcode: '211537788423',
        productTitle: `(5 Adet) Sopal${DOTLESS_I} ${TURK_BAYRAGI} 20x30 cm ${EN_DASH} Bez Alpaka ${KUMAS}`,
        productCode: 'TB-ALPAKA-SOPALI-5-20x30',
        category: 'Bayrak',
        brand: 'AKYILDIZ store',
        color: null,
        size: null,
        stockCode: null,
        stock: 100,
        currentPrice: '249.00',
        maxPrice: '249.00',
        hasCommissionTariff: false,
        externalId: 'eec44a62cba641fd75d6300c32da1957',
      },
    });
    expect(byBarcode.get('2223441235')).toStrictEqual({
      excelRow: 5,
      anchor: '2223441235',
      data: {
        barcode: '2223441235',
        productTitle: `${TURK_BAYRAGI} 300${TIMES}450 cm ${EN_DASH} 140gr Alpaka ${KUMAS} - Bina Tipi`,
        productCode: 'AKY-TB-ALP-300x450',
        category: 'Bayrak',
        brand: 'AKYILDIZ store',
        color: null,
        size: null,
        stockCode: null,
        stock: 13,
        currentPrice: '1749.00',
        maxPrice: '1749.00',
        hasCommissionTariff: true,
        externalId: '35d7e6b2e2e73b198f4be09baf2409d5',
      },
    });
    expect(byBarcode.get('8694430701051')).toStrictEqual({
      excelRow: 69,
      anchor: '8694430701051',
      data: {
        barcode: '8694430701051',
        productTitle: `Bkt-106 70x105 Cm ${TURK_BAYRAGI}`,
        productCode: 'PRA-177361-7830',
        category: 'Bayrak',
        brand: 'Buket',
        color: null,
        size: null,
        stockCode: null,
        stock: 991,
        currentPrice: '250.00',
        maxPrice: '250.00',
        hasCommissionTariff: false,
        externalId: '1ec77c26365003896ade59b1b90ad6fd',
      },
    });
  });

  it('marks the 28 rows whose commission tariff flag is set', async () => {
    const read = readRows(await realSelection());

    expect(read.rows.filter((row) => row.data.hasCommissionTariff)).toHaveLength(28);
  });

  it('finds no row the seller already filled in', async () => {
    const selection = await realSelection();
    const read = readRows(selection);
    const resolved = resolveWriteColumns(format, selection.layout);

    expect(countPrefilled(selection, read.rows, resolved)).toBe(0);
  });
});

describe('Trendyol marketplace campaign format: the keep rule and row order', () => {
  it('skips a row without a barcode, a current price or a maximum price', () => {
    const grid: SheetData = [
      [...FULL_HEADER],
      dataRow({ 1: 'Untitled', 8: 1, 9: 100, 10: 100, 12: 'Yok', 13: 'x' }),
      dataRow({ 0: 'BC-1', 1: 'Product', 8: 1, 12: 'Yok', 13: 'x' }),
      // The maximum price is required on its own: it is the first price option and the
      // ceiling of a custom price, so a row with a current price but none is dropped.
      dataRow({ 0: 'BC-3', 1: 'Product', 8: 1, 9: 150, 12: 'Yok', 13: 'z' }),
      dataRow({
        0: 'BC-2',
        1: 'Product',
        8: 5,
        9: 200,
        10: 180,
        12: CAMPAIGN_TARIFF_FLAG_YES,
        13: 'y',
      }),
    ];

    const read = readRows(gridSelection(grid));

    expect(read.rows.map((row) => row.anchor)).toEqual(['BC-2']);
    expect(read.rows[0]?.data.maxPrice).toBe('180.00');
    expect(read.rows[0]?.data.hasCommissionTariff).toBe(true);
    expect(read.skippedRows).toBe(3);
  });

  it('keeps the sheet order of the rows: the export pairs items with rows by it', () => {
    // Neither ascending nor descending, so an added sort or reverse shows.
    const grid: SheetData = [
      [...FULL_HEADER],
      dataRow({ 0: 'B-002', 1: 'Product B', 8: 1, 9: 100, 10: 90, 12: 'Yok', 13: 'b' }),
      dataRow({ 0: 'C-003', 1: 'Product C', 8: 1, 9: 100, 10: 90, 12: 'Yok', 13: 'c' }),
      dataRow({ 0: 'A-001', 1: 'Product A', 8: 1, 9: 100, 10: 90, 12: 'Yok', 13: 'a' }),
    ];

    const read = readRows(gridSelection(grid));

    expect(read.rows.map((row) => row.anchor)).toEqual(['B-002', 'C-003', 'A-001']);
  });

  it('reads a dot-thousands lira text price only with the currency grammar', async () => {
    const fixture = (await realSelection()).grid;
    const grid = derivedGrid(format.layout, format.keep, fixture, [CAMPAIGN_LIRA_TEXT]);
    const layout = present(resolveLayout(format.layout, grid), 'layout');
    const row = present(grid.at(-1), 'derived row');
    const reader = createRowReader(format.layout, layout, row, READER_OPTIONS);

    expect([reader.decimal('currentPrice'), reader.decimal('maxPrice')]).toEqual(['1250', '1250']);
    expect(
      cellDecimal(row, columnIndex(format.layout, layout, 'currentPrice'), 'plain'),
    ).toBeNull();
  });
});

describe('Trendyol marketplace campaign format: a stock its column cannot hold', () => {
  // A row the keep rule keeps: a barcode, a current price and a maximum price.
  function stockRow(stock: CellValue): CellValue[] {
    return dataRow({ 0: 'BC-1', 1: 'Product', 8: stock, 9: 100, 10: 90, 12: 'Yok', 13: 'x' });
  }

  it('refuses a stock of 1e20, past its integer column, with MALFORMED_SHEET value-out-of-range', () => {
    // The same row with a small stock is kept, so the refusal is the stock's.
    expect(readRows(gridSelection([[...FULL_HEADER], stockRow(5)])).rows[0]?.data.stock).toBe(5);

    const err = captureThrow(() => readRows(gridSelection([[...FULL_HEADER], stockRow(1e20)])));

    expect(err).toBeInstanceOf(SpreadsheetFileError);
    if (!(err instanceof SpreadsheetFileError)) return;
    expect(err.code).toBe('MALFORMED_SHEET');
    expect(err.meta).toEqual({ reason: VALUE_OUT_OF_RANGE_REASON });
  });
});

describe('Trendyol marketplace campaign format: a maximum price the export could not write', () => {
  // The first kept row of the real file and its maximum price column (column K, as the
  // header case above resolves it). MAX writes this price into the campaign price cell.
  const FIRST_KEPT_ROW = 2;
  const MAX_PRICE_COL = 10;

  function withMaxPrice(value: string): Buffer {
    return patchFixture(
      FIXTURE,
      [{ excelRow: FIRST_KEPT_ROW, col: MAX_PRICE_COL, value: { kind: 'number', value } }],
      { sheet: format.sheet },
    );
  }

  // A negative price, and one with eleven integer digits.
  it.each(['-5', '12345678901'])(
    'refuses a maximum price of %s with MALFORMED_SHEET unwritable-value',
    async (value) => {
      const selection = await realSelection(withMaxPrice(value));
      expect(columnIndex(format.layout, selection.layout, 'maxPrice')).toBe(MAX_PRICE_COL);

      const err = captureThrow(() => readRows(selection));

      expect(err).toBeInstanceOf(SpreadsheetFileError);
      if (!(err instanceof SpreadsheetFileError)) return;
      expect(err.code).toBe('MALFORMED_SHEET');
      expect(err.meta).toEqual({ reason: UNWRITABLE_VALUE_REASON });
      expect(err.message).not.toContain(value);
    },
  );

  it('keeps a maximum price as wide as the export writes', async () => {
    const read = readRows(await realSelection(withMaxPrice('9999999999.99')));

    expect(read.rows[0]?.excelRow).toBe(FIRST_KEPT_ROW);
    expect(read.rows[0]?.data.maxPrice).toBe('9999999999.99');
    expect(read.rows.length).toBe(68);
    expect(read.skippedRows).toBe(0);
  });
});

describe('Trendyol marketplace campaign format: the legacy golden digests', () => {
  it("reads the real file to the legacy parser's digest", async () => {
    const read = readRows(await realSelection());

    expect(digest(read)).toEqual(goldenEntry(FIXTURE_FILE).real);
    expect(read.rows.length).toBe(68);
    expect(read.skippedRows).toBe(0);
  });

  it("reads the derived rows to the legacy parser's digest, dropped and kept rows included", async () => {
    const fixture = (await realSelection()).grid;
    const grid = derivedGrid(format.layout, format.keep, fixture, CAMPAIGN_DERIVED);
    const read = readRows(gridSelection(grid));
    const { real, derived } = goldenEntry(FIXTURE_FILE);
    const keptCases = CAMPAIGN_DERIVED.filter((testCase) => testCase.kept).length;

    expect(digest(read)).toEqual(derived);
    // Every derived case lands on the side its `kept` flag names.
    expect(read.rows.length).toBe(real.keptRows + keptCases);
    expect(read.skippedRows).toBe(real.skippedRows + CAMPAIGN_DERIVED.length - keptCases);
    // The derived grid both drops and keeps rows, so its digest pins a row mapping and
    // not only a skipped count.
    expect(read.skippedRows).toBe(4);
    expect(read.rows.length).toBe(74);
    expect(derived.skippedRows).toBeGreaterThan(0);
    expect(derived.keptRows).toBeGreaterThan(real.keptRows);
    expect(derived.sha256).not.toBe(real.sha256);
  });
});
