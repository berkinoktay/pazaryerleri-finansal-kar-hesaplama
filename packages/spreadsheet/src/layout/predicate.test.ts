import { describe, expect, it } from 'vitest';

import type { SheetData } from '../grid-types';
import { all, any, defineLayout, has, header, headerWith, position } from './define';
import { evaluate } from './predicate';
import { resolveLayout } from './resolve';
import type { ColumnKey, ResolvedLayout } from './types';

// Pins the row keep predicate: `has text` is cellText, `has decimal` takes its grammar
// from the column's locator, and an absent column is false.

const SPEC = defineLayout({
  headerLookahead: 0,
  required: {
    barcode: header('Barkod'),
    price: headerWith(['Fiyat'], { decimal: 'currency' }),
  },
  optional: {
    plainPrice: header('Plain'),
    positionPrice: position(3, undefined, { decimal: 'currency' }),
    brand: header('Marka'),
  },
  blocks: {},
});

type Key = ColumnKey<typeof SPEC>;

const GRID: SheetData = [['Barkod', 'Fiyat', 'Plain', 'Position']];

function mustResolve(): ResolvedLayout {
  const layout = resolveLayout(SPEC, GRID);
  if (layout === null) throw new Error('expected the layout to resolve');
  return layout;
}

const LAYOUT = mustResolve();

describe('evaluate: has text', () => {
  it('is true for a non-empty text cell and for a number cell', () => {
    expect(evaluate(has('barcode', 'text'), ['8690000000001'], SPEC, LAYOUT)).toBe(true);
    expect(evaluate(has('barcode', 'text'), [8690000000001], SPEC, LAYOUT)).toBe(true);
  });

  it('is false for an empty, boolean or missing cell', () => {
    expect(evaluate(has('barcode', 'text'), ['  '], SPEC, LAYOUT)).toBe(false);
    expect(evaluate(has('barcode', 'text'), [true], SPEC, LAYOUT)).toBe(false);
    expect(evaluate(has('barcode', 'text'), [], SPEC, LAYOUT)).toBe(false);
  });

  it('is false on an absent optional column', () => {
    expect(evaluate(has('brand', 'text'), ['x', 'x', 'x', 'x', 'x'], SPEC, LAYOUT)).toBe(false);
    expect(evaluate(has('brand', 'decimal'), [1, 1, 1, 1, 1], SPEC, LAYOUT)).toBe(false);
  });
});

describe('evaluate: has decimal', () => {
  const row = ['8690000000001', '250 ₺', '250 ₺', '250 ₺'];

  it('reads with the currency grammar from a header locator', () => {
    expect(evaluate(has('price', 'decimal'), row, SPEC, LAYOUT)).toBe(true);
  });

  it('reads with the plain grammar when the locator names none', () => {
    expect(evaluate(has('plainPrice', 'decimal'), row, SPEC, LAYOUT)).toBe(false);
    expect(evaluate(has('plainPrice', 'decimal'), ['x', 'x', '250'], SPEC, LAYOUT)).toBe(true);
  });

  it('reads with the currency grammar from a position locator', () => {
    expect(evaluate(has('positionPrice', 'decimal'), row, SPEC, LAYOUT)).toBe(true);
  });

  it('is false for a non-numeric text cell', () => {
    expect(evaluate(has('price', 'decimal'), ['x', 'Kaybeden'], SPEC, LAYOUT)).toBe(false);
  });
});

describe('evaluate: all and any', () => {
  const keep = all(
    has('barcode', 'text'),
    any(has('price', 'decimal'), has('plainPrice', 'decimal')),
  );

  it('keeps a row only when every branch holds', () => {
    expect(evaluate(keep, ['8690000000001', '250 ₺'], SPEC, LAYOUT)).toBe(true);
    expect(evaluate(keep, ['8690000000001', null, '12.5'], SPEC, LAYOUT)).toBe(true);
    expect(evaluate(keep, ['8690000000001', null, null], SPEC, LAYOUT)).toBe(false);
    expect(evaluate(keep, [null, '250 ₺', '12.5'], SPEC, LAYOUT)).toBe(false);
  });

  it('treats an empty all as true and an empty any as false', () => {
    expect(evaluate(all<Key>(), [], SPEC, LAYOUT)).toBe(true);
    expect(evaluate(any<Key>(), [], SPEC, LAYOUT)).toBe(false);
  });
});
