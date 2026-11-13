import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { SheetData } from '../../src/grid-types';

// Real Trendyol exports committed under apps/api/tests/fixtures, each pinned to the
// grid the engine reads from it. `gridSha256` is sha256(JSON.stringify(grid)) measured
// on the regex normalizer that was verified identical to main at full-grid level; it
// pins every cell value, not just the shape, and must never drift. None of these grids
// holds a Date cell, so the hash does not depend on the machine's time zone.

export interface FixturePin {
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

export const FIXTURE_PINS: readonly FixturePin[] = [
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

/** The pin of the committed fixture named `file`. */
export function pinOf(file: string): FixturePin {
  const pin = FIXTURE_PINS.find((candidate) => candidate.file === file);
  if (pin === undefined) throw new Error(`no fixture pin for ${file}`);
  return pin;
}

/** The bytes of a committed fixture under apps/api/tests/fixtures. */
export function readFixture(file: string): Buffer {
  return readFileSync(new URL(`../../../../apps/api/tests/fixtures/${file}`, import.meta.url));
}

/** sha256 of JSON.stringify(grid). */
export function gridSha256(grid: SheetData): string {
  return createHash('sha256').update(JSON.stringify(grid)).digest('hex');
}
