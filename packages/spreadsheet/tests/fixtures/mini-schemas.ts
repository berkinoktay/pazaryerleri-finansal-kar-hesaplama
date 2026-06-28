import { Decimal } from 'decimal.js';
import { defineColumn } from '../../src/define-column';
import type { SheetSchema } from '../../src/types';

// --- Round-trip shape (key + editable decimal + computed + readonly + alias) ---
export interface MiniProductsRow {
  variantKey: string;
  barcode: string;
  title: string;
  cost: Decimal;
  price: Decimal;
  profit: Decimal;
}

export const miniProductsSchema: SheetSchema<MiniProductsRow> = {
  options: { sheetName: 'Urunler', rowCap: 5000, colCap: 16 },
  columns: [
    defineColumn<MiniProductsRow, 'variantKey', 'string'>({
      key: 'variantKey',
      header: 'Key',
      type: 'string',
      columnRequired: true,
      role: 'key',
      stringifyLossless: true,
    }),
    defineColumn<MiniProductsRow, 'barcode', 'string'>({
      key: 'barcode',
      header: 'Barcode',
      aliases: ['Barkod'],
      type: 'string',
      role: 'key',
      stringifyLossless: true,
    }),
    defineColumn<MiniProductsRow, 'title', 'string'>({
      key: 'title',
      header: 'Title',
      type: 'string',
      role: 'readonly',
    }),
    defineColumn<MiniProductsRow, 'cost', 'decimal'>({
      key: 'cost',
      header: 'Cost',
      type: 'decimal',
      role: 'editable',
      excelFormat: '#,##0.00',
    }),
    defineColumn<MiniProductsRow, 'price', 'decimal'>({
      key: 'price',
      header: 'Price',
      type: 'decimal',
      role: 'editable',
      excelFormat: '#,##0.00',
    }),
    defineColumn<MiniProductsRow, 'profit', 'decimal'>({
      key: 'profit',
      header: 'Profit',
      type: 'decimal',
      role: 'computed',
      excelFormat: '#,##0.00',
    }),
  ],
};

// --- Foreign shape (key + editable decimal + percent + custom date-range + dup-header case) ---
export interface DateRange {
  readonly start: Date;
  readonly end: Date;
}

export interface MiniTariffRow {
  barcode: string;
  band1: Decimal;
  rate3: Decimal;
  rate4: Decimal;
  range3: DateRange | null;
}

function parseMiniRange(raw: unknown): DateRange | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const s = String(raw);
  const [a, b] = s.split('|');
  // Guard: noUncheckedIndexedAccess makes destructured parts string|undefined
  if (a === undefined || b === undefined) return null;
  return { start: new Date(a), end: new Date(b) };
}

export const miniTariffSchema: SheetSchema<MiniTariffRow> = {
  options: { sheetName: 'Tarife', rowCap: 5000, colCap: 16 },
  columns: [
    defineColumn<MiniTariffRow, 'barcode', 'string'>({
      key: 'barcode',
      header: 'BARKOD',
      type: 'string',
      role: 'key',
      stringifyLossless: true,
    }),
    defineColumn<MiniTariffRow, 'band1', 'decimal'>({
      key: 'band1',
      header: '1.Limit',
      type: 'decimal',
      role: 'editable',
    }),
    defineColumn<MiniTariffRow, 'rate3', 'percent'>({
      key: 'rate3',
      header: 'KOMISYON (3)',
      type: 'percent',
      percentScale: 'whole',
      role: 'editable',
    }),
    defineColumn<MiniTariffRow, 'rate4', 'percent'>({
      key: 'rate4',
      header: 'KOMISYON (4)',
      type: 'percent',
      percentScale: 'whole',
      role: 'editable',
    }),
    defineColumn<MiniTariffRow, 'range3', 'custom'>({
      key: 'range3',
      header: 'Aralik (3)',
      type: 'custom',
      role: 'editable',
      parse: parseMiniRange,
    }),
  ],
};
