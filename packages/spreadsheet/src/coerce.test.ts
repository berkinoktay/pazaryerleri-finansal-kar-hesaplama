import { describe, it, expect } from 'vitest';
import { Decimal } from 'decimal.js';
import { normalizeDecimalString, coerceInbound, renderOutbound } from './coerce';
import { defineColumn } from './define-column';

interface R {
  price: Decimal;
  rate: Decimal;
  barcode: string;
  qty: number;
}

describe('normalizeDecimalString', () => {
  it.each([
    ['23,64', '23.64'],
    ['1.234,56', '1234.56'],
    ['%18', '18'],
    ['0,20', '0.20'],
    ['1234.56', '1234.56'],
    ['  8,52 TL ', '8.52'],
    ['₺1.000,00', '1000.00'],
  ])('normalizes %j -> %j', (input, expected) => {
    expect(normalizeDecimalString(input)).toBe(expected);
  });
});

describe('coerceInbound', () => {
  const priceCol = defineColumn<R, 'price', 'decimal'>({
    key: 'price',
    header: 'P',
    type: 'decimal',
    role: 'editable',
  });
  const rateCol = defineColumn<R, 'rate', 'percent'>({
    key: 'rate',
    header: 'K',
    type: 'percent',
    percentScale: 'whole',
    role: 'editable',
  });
  const barcodeCol = defineColumn<R, 'barcode', 'string'>({
    key: 'barcode',
    header: 'B',
    type: 'string',
    role: 'key',
    stringifyLossless: true,
  });

  it('parses a numeric decimal cell to Decimal', () => {
    expect((coerceInbound(priceCol, 777.1) as Decimal).toString()).toBe('777.1');
  });
  it('parses a tr-TR string decimal', () => {
    expect((coerceInbound(priceCol, '1.234,56') as Decimal).toString()).toBe('1234.56');
  });
  it('scales a whole percent to a fraction', () => {
    expect((coerceInbound(rateCol, 19) as Decimal).toString()).toBe('0.19');
  });
  it('losslessly stringifies a numeric barcode without exponent', () => {
    expect(coerceInbound(barcodeCol, 8680000000017)).toBe('8680000000017');
  });
  it('throws on non-numeric decimal', () => {
    expect(() => coerceInbound(priceCol, 'abc')).toThrow();
  });
});

describe('renderOutbound', () => {
  const priceCol = defineColumn<R, 'price', 'decimal'>({
    key: 'price',
    header: 'P',
    type: 'decimal',
    role: 'editable',
  });
  it('renders Decimal as a Number cell at the wire boundary', () => {
    expect(renderOutbound(priceCol, new Decimal('852.00'))).toEqual({ value: 852, type: 'Number' });
  });
  it('renders null/undefined Decimal as an empty cell (never 0, never throw)', () => {
    expect(renderOutbound(priceCol, null)).toEqual({ value: null, type: 'String' });
    expect(renderOutbound(priceCol, undefined)).toEqual({ value: null, type: 'String' });
  });
});
