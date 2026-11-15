// The Trendyol discount format on its own, with no legacy code: the header cases of the
// old resolver's test, three literal rows of the real file, and the permanent golden
// digests of tests/fixtures/workbook-golden/legacy-rows.json, which the legacy import
// parser wrote before it was deleted. A change to `mapRow` or the keep rule that alters
// any field of any row, on the real file or on its derived rows, fails here.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  columnIndex,
  readWorkbookGrid,
  resolveLayout,
  type SheetData,
} from '@pazarsync/spreadsheet';
import { describe, expect, it, vi } from 'vitest';

import { FORMAT_SUMMARIES } from '@/workbooks/formats/registry';
import { trendyolDiscountListFormat } from '@/workbooks/formats/trendyol/discount-list.format';
import { NO_LABEL, YES_LABEL } from '@/workbooks/formats/trendyol/labels';
import { readRows } from '@/workbooks/import-rows';
import { selectFormat } from '@/workbooks/select-format';

import { canonicalJson, sha256Hex } from '../../../helpers/canonical-json';
import { DISCOUNT_DERIVED, derivedGrid } from '../../../helpers/workbook-derived-rows';

// The fixture is read through the parse worker, whose cold start can pass vitest's 5 s
// default under load.
vi.setConfig({ testTimeout: 60_000 });

const FIXTURE_FILE = 'trendyol-discount-products.xlsx';
const FIXTURES_DIR = resolve(__dirname, '../../../fixtures');
const FIXTURE = readFileSync(resolve(FIXTURES_DIR, FIXTURE_FILE));
const GOLDEN_PATH = resolve(FIXTURES_DIR, 'workbook-golden/legacy-rows.json');

const format = trendyolDiscountListFormat;

// Turkish letters, by code point.
const U_UMLAUT_UPPER = String.fromCodePoint(0x00dc);
const U_UMLAUT = String.fromCodePoint(0x00fc);
const DOTLESS_I = String.fromCodePoint(0x0131);
const S_CEDILLA = String.fromCodePoint(0x015f);

const URUN = `${U_UMLAUT_UPPER}r${U_UMLAUT}n`;
const CURRENT_PRICE_HEADER = `G${U_UMLAUT}ncel Sat${DOTLESS_I}${S_CEDILLA} Fiyat${DOTLESS_I}`;
const INCLUDED_TYPO = 'Kampayaya Dahil Edilsin Mi?';
const INCLUDED_CORRECT = 'Kampanyaya Dahil Edilsin Mi?';

// The real Trendyol header, as the legacy resolver's test held it.
const FULL_HEADER: readonly string[] = [
  `Trendyol ${URUN} ID`,
  `${URUN} Bilgisi`,
  'Marka',
  'Renk',
  'Barkod',
  'Model Kodu',
  CURRENT_PRICE_HEADER,
  'Buybox',
  INCLUDED_TYPO,
];

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

async function realSelection() {
  return selectFormat(FIXTURE, [format], {
    read: (file, sheet) => readWorkbookGrid(file, { sheet }),
    summaries: FORMAT_SUMMARIES,
  });
}

function derivedSelection(fixture: SheetData) {
  const grid = derivedGrid(format.layout, format.keep, fixture, DISCOUNT_DERIVED);
  return { format, grid, layout: present(resolveLayout(format.layout, grid), 'layout') };
}

describe('Trendyol discount format: headers', () => {
  it('is the header row of the real fixture', async () => {
    const selection = await realSelection();

    expect(selection.grid[0]).toEqual(FULL_HEADER);
  });

  it('resolves every column of the real Trendyol header', () => {
    const layout = present(headerLayout(FULL_HEADER), 'layout');

    expect(columnIndex(format.layout, layout, 'barcode')).toBe(4);
    expect(columnIndex(format.layout, layout, 'currentPrice')).toBe(6);
    expect(columnIndex(format.layout, layout, 'included')).toBe(8);
  });

  it('survives a column reorder (header-name resolution)', () => {
    const layout = present(headerLayout([...FULL_HEADER].reverse()), 'layout');

    expect(columnIndex(format.layout, layout, 'barcode')).toBe(4);
    expect(columnIndex(format.layout, layout, 'included')).toBe(0);
  });

  it('does not resolve when a required column is missing', () => {
    expect(headerLayout(FULL_HEADER.filter((h) => h !== 'Barkod'))).toBeNull();
    expect(headerLayout(FULL_HEADER.filter((h) => h !== INCLUDED_TYPO))).toBeNull();
  });

  it('takes the vendor typo over the corrected spelling, even when the typo sits to its right', () => {
    const header = ['Barkod', CURRENT_PRICE_HEADER, INCLUDED_CORRECT, INCLUDED_TYPO];
    const layout = present(headerLayout(header), 'layout');

    expect(columnIndex(format.layout, layout, 'included')).toBe(3);
  });

  it('resolves the participation column under the corrected spelling alone', () => {
    const header = FULL_HEADER.map((h) => (h === INCLUDED_TYPO ? INCLUDED_CORRECT : h));
    const layout = present(headerLayout(header), 'layout');

    expect(columnIndex(format.layout, layout, 'included')).toBe(8);
  });
});

describe('Trendyol discount format: rows of the real file', () => {
  it('maps the first row, a middle row and the pre-marked last row in full', async () => {
    const read = readRows(await realSelection());
    const byBarcode = new Map(read.rows.map((r) => [r.anchor, r]));

    expect(byBarcode.get('DISC-BC-1')).toStrictEqual({
      excelRow: 2,
      anchor: 'DISC-BC-1',
      data: {
        barcode: 'DISC-BC-1',
        externalId: '100000001',
        productTitle: `Anonim ${URUN} 1`,
        brand: 'Marka A',
        color: `K${DOTLESS_I}rm${DOTLESS_I}z${DOTLESS_I}`,
        modelCode: 'MDL-1',
        currentPrice: '250',
        included: false,
      },
    });
    expect(byBarcode.get('DISC-BC-2')).toStrictEqual({
      excelRow: 3,
      anchor: 'DISC-BC-2',
      data: {
        barcode: 'DISC-BC-2',
        externalId: '100000002',
        productTitle: `Anonim ${URUN} 2`,
        brand: 'Marka B',
        color: 'Mavi',
        modelCode: 'MDL-2',
        currentPrice: '250',
        included: false,
      },
    });
    // The fixture's only row already marked for the campaign is its last row.
    expect(byBarcode.get('DISC-BC-4')).toStrictEqual({
      excelRow: 5,
      anchor: 'DISC-BC-4',
      data: {
        barcode: 'DISC-BC-4',
        externalId: '100000004',
        productTitle: `Anonim ${URUN} 4`,
        brand: 'Marka D',
        color: 'Siyah',
        modelCode: 'MDL-4',
        currentPrice: '250',
        included: true,
      },
    });
  });
});

describe('Trendyol discount format: fallbacks', () => {
  function readGrid(grid: SheetData) {
    return readRows({
      format,
      grid,
      layout: present(resolveLayout(format.layout, grid), 'layout'),
    });
  }

  it('titles a row by its barcode when its title cell is blank', () => {
    const grid: SheetData = [
      [...FULL_HEADER],
      ['100000009', '', 'Marka X', 'Renk X', 'DISC-X-1', 'MDL-X', 99.5, 'Buybox X', NO_LABEL],
    ];

    expect(readGrid(grid).rows.map((row) => row.data)).toStrictEqual([
      {
        barcode: 'DISC-X-1',
        externalId: '100000009',
        productTitle: 'DISC-X-1',
        brand: 'Marka X',
        color: 'Renk X',
        modelCode: 'MDL-X',
        currentPrice: '99.5',
        included: false,
      },
    ]);
  });

  it('reads every absent optional column as null, and titles the row by its barcode', () => {
    // Only the three required columns.
    const grid: SheetData = [
      ['Barkod', CURRENT_PRICE_HEADER, INCLUDED_TYPO],
      ['DISC-X-2', 120, YES_LABEL],
    ];

    expect(readGrid(grid).rows.map((row) => row.data)).toStrictEqual([
      {
        barcode: 'DISC-X-2',
        externalId: null,
        productTitle: 'DISC-X-2',
        brand: null,
        color: null,
        modelCode: null,
        currentPrice: '120',
        included: true,
      },
    ]);
  });
});

describe('Trendyol discount format: the legacy golden digests', () => {
  it("reads the real file to the legacy parser's digest", async () => {
    const read = readRows(await realSelection());

    expect(digest(read)).toEqual(goldenEntry(FIXTURE_FILE).real);
  });

  it("reads the derived rows to the legacy parser's digest, dropped and kept rows included", async () => {
    const fixture = (await realSelection()).grid;
    const read = readRows(derivedSelection(fixture));
    const { real, derived } = goldenEntry(FIXTURE_FILE);
    const keptCases = DISCOUNT_DERIVED.filter((testCase) => testCase.kept).length;

    expect(digest(read)).toEqual(derived);
    // Every derived case lands on the side its `kept` flag names.
    expect(read.rows.length).toBe(real.keptRows + keptCases);
    expect(read.skippedRows).toBe(real.skippedRows + DISCOUNT_DERIVED.length - keptCases);
    // The derived grid both drops and keeps rows, so its digest pins a row mapping and
    // not only a skipped count.
    expect(read.skippedRows).toBe(2);
    expect(read.rows.length).toBe(6);
    expect(derived.skippedRows).toBeGreaterThan(0);
    expect(derived.keptRows).toBeGreaterThan(real.keptRows);
    expect(derived.sha256).not.toBe(real.sha256);
  });
});
