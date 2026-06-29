import { describe, it, expect } from 'vitest';
import { Decimal } from 'decimal.js';
import { exportToXlsx } from './export';
import { miniProductsSchema, type MiniProductsRow } from '../tests/fixtures/mini-schemas';
import { readSheetDimensions, colRefToNumber } from './sheet-meta';

describe('colRefToNumber', () => {
  it.each([
    ['A', 1],
    ['Z', 26],
    ['AA', 27],
    ['AI', 35],
  ])('%s -> %i', (ref, n) => {
    expect(colRefToNumber(ref)).toBe(n);
  });
});

describe('readSheetDimensions', () => {
  it('extracts row/col counts from a generated xlsx', async () => {
    const rows: MiniProductsRow[] = Array.from({ length: 3 }, (_, i) => ({
      variantKey: `V${i}`,
      barcode: '1',
      title: 't',
      cost: new Decimal('1'),
      price: new Decimal('2'),
      profit: new Decimal('1'),
    }));
    const buf = await exportToXlsx(miniProductsSchema, rows);
    const dims = readSheetDimensions(buf);
    expect(dims.length).toBeGreaterThanOrEqual(1);
    expect(dims[0]!.cols).toBe(6); // 6 kolonlu miniProductsSchema
    expect(dims[0]!.rows).toBe(4); // 1 başlık + 3 veri satırı
  });
});
