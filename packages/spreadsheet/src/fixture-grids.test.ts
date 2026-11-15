import { describe, expect, it } from 'vitest';

import { DEFAULT_COL_CAP, DEFAULT_MAX_BYTES, DEFAULT_ROW_CAP } from './constants';
import type { SheetData } from './grid-types';
import { openUpload } from './guards';
import { readWorkbookGrid } from './parse';
import { buildXlsxFixture, worksheetXml } from './testing/build-xlsx';
import { FIXTURE_PINS, gridSha256, readFixture } from '../tests/helpers/fixture-pins';

// Real Trendyol exports committed under apps/api/tests/fixtures. The engine's own
// reader replaced the read copy and the reader library that read it, so a seller's
// normal file must keep producing the exact same grid, cell for cell. The pins
// (tests/helpers/fixture-pins.ts) hold sha256(JSON.stringify(grid)) for each file;
// they pin every cell value, not just the shape, and must never drift.

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

describe('fixture grids are unchanged', () => {
  it.each(FIXTURE_PINS)('$file', async (fixture) => {
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

const GUARD_OPTS = {
  rowCap: DEFAULT_ROW_CAP,
  colCap: DEFAULT_COL_CAP,
  maxBytes: DEFAULT_MAX_BYTES,
};

// Every rule of the gate, the zip layout, the view check, the root relationships, the
// unsafe parts and the worksheet formula scan included, accepts a seller's normal file.
// The reads above also pass the reader's style and AlternateContent rules.
describe('fixtures pass the upload gate', () => {
  it.each(FIXTURE_PINS)('$file', (fixture) => {
    expect(() => openUpload(readFixture(fixture.file), GUARD_OPTS)).not.toThrow();
  });
});

// A ~1.5 KB upload whose forged <dimension ref="A1:ZZ300000"/> made the old reader
// allocate a 300 000 x 702 grid and crash the API with an out-of-memory error. The
// reader never reads a dimension: it sizes the grid from the cells that exist.
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
