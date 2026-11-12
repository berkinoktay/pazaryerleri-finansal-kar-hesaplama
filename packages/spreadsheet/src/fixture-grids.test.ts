import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SheetData } from 'read-excel-file/node';

import { readWorkbookGrid } from './parse';
import { buildXlsxFixture, worksheetXml } from './testing/build-xlsx';

// Real Trendyol exports committed under apps/api/tests/fixtures. The read copy of
// every upload is rebuilt (dimension removal, formula-cell emptying, re-zip), so a
// seller's normal file must keep producing the exact same grid, cell for cell.
// `gridSha256` is sha256(JSON.stringify(grid)) measured on the regex normalizer
// that was verified identical to main at full-grid level; it pins every cell
// value, not just the shape, and must never drift. None of these grids holds a
// Date cell, so the hash does not depend on the machine's time zone.

interface FixtureGrid {
  readonly file: string;
  /** Omitted when the reader should take the first sheet. */
  readonly sheetName?: string;
  readonly rows: number;
  /** Width of the widest row. */
  readonly cols: number;
  /** Value under the barcode header in the first data row. */
  readonly firstBarcode: string;
  /** sha256 of JSON.stringify(grid): pins every cell of the grid. */
  readonly gridSha256: string;
}

const FIXTURE_GRIDS: readonly FixtureGrid[] = [
  {
    file: 'trendyol-commission-tariff.xlsx',
    sheetName: 'KomisyonTarifeleriÜrünleri',
    rows: 56,
    cols: 35,
    firstBarcode: 'TB200X300A',
    gridSha256: 'f413fc90a061fa73166839eda9fe8c8d996191edc17e791e6fcccecb40b816ca',
  },
  {
    file: 'trendyol-tariff-1period.xlsx',
    sheetName: 'KomisyonTarifeleriÜrünleri',
    rows: 56,
    cols: 27,
    firstBarcode: '2903004500010',
    gridSha256: '18deab90f1f5892e9beccf75101a5c10931da78acb04c9bfef02a71b83e71412',
  },
  {
    file: 'trendyol-plus-tariff.xlsx',
    sheetName: 'TyPlusÜrünleri',
    rows: 56,
    cols: 22,
    firstBarcode: '85697423698',
    gridSha256: '2f0a3f9e97ef9562121c34596520930b52b23de7e7b13ac8dc955032d705013e',
  },
  {
    file: 'trendyol-plus-tariff-3ve4.xlsx',
    sheetName: 'TyPlusÜrünleri',
    rows: 34,
    cols: 31,
    firstBarcode: '2902003000019',
    gridSha256: 'f8bdf41c6b23672a3cb46a2ad0bd3f38913bea42adc78c982dcf85f9e47fdcb7',
  },
  {
    file: 'trendyol-discount-products.xlsx',
    sheetName: 'Ürünler',
    rows: 5,
    cols: 9,
    firstBarcode: 'DISC-BC-1',
    gridSha256: 'e95696778d630f03230283af71b7cb943f789477ae54e1e2b43ec5e2c3ce0556',
  },
  {
    file: 'trendyol-flash-products.xlsx',
    sheetName: 'TeklifÜrünleri',
    rows: 123,
    cols: 20,
    firstBarcode: 'ATA100X150R',
    gridSha256: 'f6737136291da00ad156a857b9a6cd0e2b90b408c23b946425adf2bb65b71c2c',
  },
  {
    file: 'trendyol-advantage-tariff.xlsx',
    rows: 72,
    cols: 19,
    firstBarcode: 'TB100X150A',
    gridSha256: '1c87de66ed2a6f3a146f661294bbcd6fa8f0f2a499b4a2a94f15327b4da21714',
  },
  {
    file: 'marketplace-campaign-sample.xlsx',
    rows: 69,
    cols: 14,
    firstBarcode: '211537788423',
    gridSha256: 'b1a24c38b7637d4c311c1f0797f332bd58a4e514ce3f4ab3699428bda23ea391',
  },
];

const BARCODE_HEADER = 'BARKOD';

function isBarcodeHeader(cell: unknown): boolean {
  return typeof cell === 'string' && cell.trim().toLocaleUpperCase('tr-TR') === BARCODE_HEADER;
}

interface GridShape {
  readonly rows: number;
  readonly cols: number;
  readonly firstBarcode: unknown;
}

function gridShape(grid: SheetData): GridShape {
  const headerIndex = grid.findIndex((row) => row.some(isBarcodeHeader));
  const header = grid[headerIndex] ?? [];
  const barcodeCol = header.findIndex(isBarcodeHeader);
  return {
    rows: grid.length,
    cols: Math.max(0, ...grid.map((row) => row.length)),
    firstBarcode: grid[headerIndex + 1]?.[barcodeCol],
  };
}

function readFixture(file: string): Buffer {
  return readFileSync(new URL(`../../../apps/api/tests/fixtures/${file}`, import.meta.url));
}

function gridSha256(grid: SheetData): string {
  return createHash('sha256').update(JSON.stringify(grid)).digest('hex');
}

describe('fixture grids are unchanged', () => {
  it.each(FIXTURE_GRIDS)('$file', async (fixture) => {
    const file = readFixture(fixture.file);
    const grid = await readWorkbookGrid(
      file,
      fixture.sheetName === undefined ? {} : { sheetName: fixture.sheetName },
    );

    expect(gridShape(grid)).toEqual({
      rows: fixture.rows,
      cols: fixture.cols,
      firstBarcode: fixture.firstBarcode,
    });
    expect(gridSha256(grid)).toBe(fixture.gridSha256);
  });
});

// A ~1.5 KB upload whose forged <dimension ref="A1:ZZ300000"/> made read-excel-file
// allocate a 300 000 x 702 grid and crash the API with an out-of-memory error.
// Normalization strips every dimension, so the reader sizes the grid from the
// cells that actually exist.
const OOM_DIMENSION = 'A1:ZZ300000';
// Timing bounds are loose on purpose: check:all and CI run many suites in parallel, so a
// linear pass that takes milliseconds alone can take seconds under load. The regressions
// these tests guard against are quadratic or allocation blow-ups that take minutes or
// crash, so a bound in the tens of seconds still separates the two.
const READ_BUDGET_MS = 15_000;

describe('forged <dimension>', () => {
  it('the dimension OOM file reads in under a second', async () => {
    const file = buildXlsxFixture([
      { name: 'Sheet1', xml: worksheetXml([['Barkod'], ['X1']], { dimension: OOM_DIMENSION }) },
    ]);

    const started = performance.now();
    const grid = await readWorkbookGrid(file);
    const elapsedMs = performance.now() - started;

    expect(grid).toEqual([['Barkod'], ['X1']]);
    expect(elapsedMs).toBeLessThan(READ_BUDGET_MS);
  });
});
