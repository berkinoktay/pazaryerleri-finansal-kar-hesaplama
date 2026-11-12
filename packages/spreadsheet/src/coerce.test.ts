import { describe, it, expect } from 'vitest';
import { normalizeDecimalString } from './coerce';

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
