import { describe, it, expect } from 'vitest';
import { readWorkbookGrid } from '../parse';
import { buildXlsxFixture, worksheetXml } from './build-xlsx';

const ROWS = [
  ['Barkod', 'Fiyat'],
  ['B1', 10],
] as const;

describe('buildXlsxFixture', () => {
  it('builds a workbook the grid reader can read', async () => {
    const file = buildXlsxFixture([{ name: 'Ürünler', xml: worksheetXml(ROWS) }]);
    const grid = await readWorkbookGrid(file, { sheetName: 'Ürünler' });
    expect(grid).toEqual([
      ['Barkod', 'Fiyat'],
      ['B1', 10],
    ]);
  });

  it('honours a prefix', async () => {
    const file = buildXlsxFixture([{ name: 'Ürünler', xml: worksheetXml(ROWS, { prefix: 'x' }) }]);
    const grid = await readWorkbookGrid(file, { sheetName: 'Ürünler' });
    expect(grid).toEqual([
      ['Barkod', 'Fiyat'],
      ['B1', 10],
    ]);
  });
});
