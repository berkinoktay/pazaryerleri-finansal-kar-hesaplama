import { describe, expect, it } from 'vitest';
import { cellCurrencyDecimalString } from '@/lib/xlsx-grid-cells';

describe('cellCurrencyDecimalString', () => {
  it('strips the ₺ suffix Trendyol writes into "Güncel Satış Fiyatı"', () => {
    expect(cellCurrencyDecimalString(['250 ₺'], 0)).toBe('250');
  });
  it('resolves Turkish thousands+decimal separators with currency noise', () => {
    expect(cellCurrencyDecimalString(['1.234,56 ₺'], 0)).toBe('1234.56');
  });
  it('reads Turkish dot-only thousands as an integer (no comma decimal)', () => {
    expect(cellCurrencyDecimalString(['1.250 ₺'], 0)).toBe('1250');
    expect(cellCurrencyDecimalString(['1.250.000 ₺'], 0)).toBe('1250000');
  });
  it('keeps a 2-digit tail as a decimal, not thousands', () => {
    expect(cellCurrencyDecimalString(['1.25'], 0)).toBe('1.25');
  });
  it('passes plain numbers through', () => {
    expect(cellCurrencyDecimalString([250], 0)).toBe('250');
  });
  it('returns null for empty and non-numeric cells', () => {
    expect(cellCurrencyDecimalString([''], 0)).toBeNull();
    expect(cellCurrencyDecimalString(['Kaybeden'], 0)).toBeNull();
    expect(cellCurrencyDecimalString([], 0)).toBeNull();
  });
});
