import { describe, it, expect } from 'vitest';
import { Decimal } from 'decimal.js';
import { readSheet } from 'read-excel-file/node';
import { exportToXlsx } from './export';
import { miniProductsSchema, type MiniProductsRow } from '../tests/fixtures/mini-schemas';

const rows: MiniProductsRow[] = [
  {
    variantKey: 'V1',
    barcode: '8680000000017',
    title: 'Bayrak',
    cost: new Decimal('10.50'),
    price: new Decimal('25.00'),
    profit: new Decimal('9.90'),
  },
];

describe('exportToXlsx', () => {
  it('writes headers in schema order and round-trips values', async () => {
    const buf = await exportToXlsx(miniProductsSchema, rows);
    const grid = await readSheet(buf); // schema-less: raw 2D array
    // Use .at() to satisfy noUncheckedIndexedAccess without unsafe assertions
    expect(grid.at(0)).toEqual(['Key', 'Barcode', 'Title', 'Cost', 'Price', 'Profit']);
    expect(grid.at(1)?.at(0)).toBe('V1');
    expect(grid.at(1)?.at(1)).toBe('8680000000017'); // string cell, no scientific notation
    expect(Number(grid.at(1)?.at(3))).toBeCloseTo(10.5);
  });

  it('renders a null computed/editable value as an empty cell, never 0', async () => {
    // Explicit type annotation so TypeScript does not widen the spread to optional properties.
    // rows[0]! — non-null assertion (not a type cast); rows is a non-empty array literal.
    // null as unknown as Decimal — intentional runtime escape: tests what happens when a
    // Decimal field is null at runtime (bypasses the static type).
    const withNull: MiniProductsRow[] = [
      { ...rows[0]!, cost: null as unknown as Decimal, profit: null as unknown as Decimal },
    ];
    const buf = await exportToXlsx(miniProductsSchema, withNull);
    const grid = await readSheet(buf);
    const cell = grid.at(1)?.at(3);
    expect(cell === null || cell === '' || cell === undefined).toBe(true);
  });

  it('sanitizes a formula-injection title', async () => {
    // rows[0]! — non-null assertion; the array is defined above with exactly one element.
    const evil: MiniProductsRow[] = [{ ...rows[0]!, title: '=HYPERLINK("http://x")' }];
    const buf = await exportToXlsx(miniProductsSchema, evil);
    const grid = await readSheet(buf);
    expect(String(grid.at(1)?.at(2)).startsWith("'=")).toBe(true);
  });
});
