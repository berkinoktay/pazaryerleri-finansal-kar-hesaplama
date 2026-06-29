import { describe, it, expect } from 'vitest';
import { Decimal } from 'decimal.js';
import { readSheet } from 'read-excel-file/node';
import { exportToXlsx } from './export';
import { miniProductsSchema, type MiniProductsRow } from '../tests/fixtures/mini-schemas';
import { defineColumn } from './define-column';
import type { SheetSchema } from './types';

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

  it('col.format — serializes a custom domain object to a string (not [object Object])', async () => {
    interface RangeRow {
      id: string;
      range: { start: string; end: string };
    }

    const schema: SheetSchema<RangeRow> = {
      options: { sheetName: 'RangeTest', rowCap: 100, colCap: 8 },
      columns: [
        defineColumn<RangeRow, 'id', 'string'>({
          key: 'id',
          header: 'ID',
          type: 'string',
          role: 'key',
          stringifyLossless: true,
        }),
        defineColumn<RangeRow, 'range', 'custom'>({
          key: 'range',
          header: 'Range',
          type: 'custom',
          role: 'readonly',
          // format is the export serializer; without it, String({...}) = '[object Object]'
          format(value) {
            return `${value.start}|${value.end}`;
          },
          parse(_raw: unknown): { start: string; end: string } {
            return { start: '', end: '' };
          },
        }),
      ],
    };

    const buf = await exportToXlsx(schema, [
      { id: 'R1', range: { start: '2024-01-01', end: '2024-12-31' } },
    ]);
    const grid = await readSheet(buf);
    // Without I1, the cell would be '[object Object]'. With I1, it is the formatted string.
    expect(grid.at(1)?.at(1)).toBe('2024-01-01|2024-12-31');
  });
});
