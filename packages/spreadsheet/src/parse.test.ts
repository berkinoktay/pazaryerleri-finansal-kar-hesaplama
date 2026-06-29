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
import { defineColumn } from './define-column';
import type { SheetSchema } from './types';
import { MAX_ERROR_VALUE_LENGTH } from './constants';

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

  it('validate — rejects negative decimal and produces INVALID_VALUE; row dropped', async () => {
    interface ValidateRow {
      id: string;
      price: Decimal;
    }

    const schema: SheetSchema<ValidateRow> = {
      options: { sheetName: 'ValidateTest', rowCap: 100, colCap: 8 },
      columns: [
        defineColumn<ValidateRow, 'id', 'string'>({
          key: 'id',
          header: 'ID',
          type: 'string',
          role: 'key',
          stringifyLossless: true,
        }),
        defineColumn<ValidateRow, 'price', 'decimal'>({
          key: 'price',
          header: 'Price',
          type: 'decimal',
          role: 'editable',
          validate(value) {
            if (value.lt(0)) {
              return { code: 'INVALID_VALUE' as const, detail: 'Price must be non-negative' };
            }
          },
        }),
      ],
    };

    // Export a row with a negative price so the exported cell value is negative.
    const buf = await exportToXlsx(schema, [{ id: 'A1', price: new Decimal('-5.00') }]);
    const result = await parseXlsx(schema, buf);

    // Row is dropped because the library drops any row that has a type-function error.
    expect(result.rows).toHaveLength(0);
    // The error is surfaced as INVALID_VALUE (validate message is not a known INVALID_TYPE reason).
    const err = result.errors.find((e) => e.columnKey === 'price');
    expect(err).toBeDefined();
    expect(err?.code).toBe('INVALID_VALUE');
  });

  it('value truncation — CellError.value is capped at MAX_ERROR_VALUE_LENGTH', async () => {
    // Strategy: export a string value that is longer than MAX_ERROR_VALUE_LENGTH using a
    // string-typed key column, then parse with a decimal-typed editable column carrying the same
    // header. The long string cannot be parsed as a decimal, so the library records an error
    // with e.value set to the raw cell string. I3 must truncate it to MAX_ERROR_VALUE_LENGTH.
    interface StrRow {
      id: string;
    }
    interface DecRow {
      id: Decimal;
    }

    const exportSchema: SheetSchema<StrRow> = {
      options: { sheetName: 'TruncTest', rowCap: 100, colCap: 8 },
      columns: [
        defineColumn<StrRow, 'id', 'string'>({
          key: 'id',
          header: 'ID',
          type: 'string',
          role: 'key',
          stringifyLossless: true,
        }),
      ],
    };

    const parseSchema: SheetSchema<DecRow> = {
      options: { sheetName: 'TruncTest', rowCap: 100, colCap: 8 },
      columns: [
        defineColumn<DecRow, 'id', 'decimal'>({
          key: 'id',
          header: 'ID',
          type: 'decimal',
          role: 'editable',
        }),
      ],
    };

    const longStr = 'A'.repeat(MAX_ERROR_VALUE_LENGTH + 10);
    const buf = await exportToXlsx(exportSchema, [{ id: longStr }]);
    const result = await parseXlsx(parseSchema, buf);

    const err = result.errors.find((e) => e.columnKey === 'id');
    expect(err).toBeDefined();
    // The library sets e.value to the raw cell string; after I3 it must be truncated.
    if (typeof err?.value === 'string') {
      expect(err.value.length).toBeLessThanOrEqual(MAX_ERROR_VALUE_LENGTH);
    }
    // Whether or not the library sets e.value as a string, the error must be present.
    expect(err?.code).toMatch(/INVALID_TYPE|INVALID_VALUE/);
  });

  it('percent round-trip — whole scale: Decimal(0.19) exports as 19, parses back to 0.19', async () => {
    // Before I4, renderOutbound wrote 0.19 to the cell; coerceInbound then divided by 100
    // again, yielding 0.0019. After I4, renderOutbound writes 19 (0.19 × 100), and
    // coerceInbound divides back to 0.19 — a symmetric round-trip.
    const tariff: MiniTariffRow[] = [
      {
        barcode: 'B1',
        band1: new Decimal('10'),
        rate3: new Decimal('0.19'), // whole-scale percent stored as fraction
        rate4: new Decimal('0.10'),
        range3: null,
      },
    ];

    const buf = await exportToXlsx(miniTariffSchema, tariff);
    const result = await parseXlsx(miniTariffSchema, buf);

    expect(result.errors).toHaveLength(0);
    expect(result.validRows).toBe(1);
    const data = result.rows.at(0)?.data;
    // rate3 must survive the round-trip: 0.19 → export 19 → parse 0.19.
    expect((data?.rate3 as Decimal | undefined)?.toString()).toBe('0.19');
  });
});
