import { describe, it, expect } from 'vitest';
import { Decimal } from 'decimal.js';
import { exportToXlsx } from './export';
import { parseXlsx } from './parse';
import {
  miniProductsSchema,
  miniTariffSchema,
  type MiniProductsRow,
  type MiniTariffRow,
} from '../tests/fixtures/mini-schemas';

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

describe('parseXlsx', () => {
  it('returns only key + editable fields; drops readonly/computed', async () => {
    const buf = await exportToXlsx(miniProductsSchema, rows);
    const result = await parseXlsx(miniProductsSchema, buf);
    expect(result.totalRows).toBe(1);
    expect(result.validRows).toBe(1);
    // Use .at() to satisfy noUncheckedIndexedAccess without unsafe assertions
    const data = result.rows.at(0)?.data;
    expect(data?.variantKey).toBe('V1');
    expect(data?.barcode).toBe('8680000000017');
    expect((data?.cost as Decimal | undefined)?.toString()).toBe('10.5');
    expect(data?.title).toBeUndefined(); // readonly dropped
    expect(data?.profit).toBeUndefined(); // computed dropped
  });

  it('reports dataRow and excelRow', async () => {
    const buf = await exportToXlsx(miniProductsSchema, rows);
    const result = await parseXlsx(miniProductsSchema, buf);
    expect(result.rows.at(0)?.dataRow).toBe(1);
    expect(result.rows.at(0)?.excelRow).toBe(2); // header is Excel row 1
  });

  it('does not call a custom parser on an empty non-required cell', async () => {
    const tariff: MiniTariffRow[] = [
      {
        barcode: 'X',
        band1: new Decimal('10'),
        rate3: new Decimal('0.19'),
        rate4: new Decimal('0.10'),
        range3: null,
      },
    ];
    const buf = await exportToXlsx(miniTariffSchema, tariff);
    const result = await parseXlsx(miniTariffSchema, buf);
    expect(result.errors).toHaveLength(0); // empty range3 must not produce an error
    expect(result.validRows).toBe(1);
  });
});
