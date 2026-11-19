import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import type { SheetData } from '../grid-types';
import { block, defineLayout, header, headerWith } from './define';
import { resolveLayout } from './resolve';
import { createRowReader } from './row-reader';
import type { ResolvedLayout } from './types';

// Pins the typed row reader: each method reads through the cell readers at the
// layout's resolved index, the decimal grammar comes from the locator (column, block
// column or block lookup), an absent column reads as null or false, and block readers
// come back in column order with their tags.

const SPEC = defineLayout({
  headerLookahead: 0,
  required: {
    barcode: header('Barcode'),
    price: headerWith(['Price'], { decimal: 'currency' }),
  },
  optional: {
    plainPrice: header('Plain Price'),
    stock: header('Stock'),
    cancelled: header('Cancelled'),
    active: header('Active'),
    window: header('Window'),
    brand: header('Brand'),
  },
  blocks: {
    periods: block({
      anchor: /^Period \((\d+) Days\)$/,
      follow: ['Offer'],
      columns: {
        label: { offset: 0 },
        offer: { offset: 1, decimal: 'currency' },
        rate: { offset: 2 },
      },
      lookups: {
        computed: { template: 'Computed ({tag} Days)', decimal: 'currency' },
      },
      min: 1,
    }),
  },
});

// 'Brand' is absent, and only the 7-day block has a 'Computed' header.
const HEADER = [
  'Barcode',
  'Price',
  'Plain Price',
  'Stock',
  'Cancelled',
  'Active',
  'Window',
  'Period (3 Days)',
  'Offer',
  'Rate',
  'Period (7 Days)',
  'Offer',
  'Rate',
  'Computed (7 Days)',
];

const ROW = [
  '8690000000001',
  '250 TL',
  '250 TL',
  '007',
  1,
  'VAR',
  '05/11/2026 14:30',
  '01/11/2026 - 03/11/2026',
  '99,90 TL',
  '250 TL',
  '01/11/2026 - 07/11/2026',
  '89,90 TL',
  '12.5',
  '15 TL',
];

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

/** Istanbul-like conversion: the wall clock is three hours ahead of UTC. */
function toInstant(wallClockMs: number): Date {
  return new Date(wallClockMs - THREE_HOURS_MS);
}

function mustResolve(): ResolvedLayout {
  const grid: SheetData = [HEADER];
  const layout = resolveLayout(SPEC, grid);
  if (layout === null) throw new Error('expected the layout to resolve');
  return layout;
}

const LAYOUT = mustResolve();

describe('createRowReader: columns', () => {
  const reader = createRowReader(SPEC, LAYOUT, ROW, { toInstant });

  it('reads text at the resolved column', () => {
    expect(reader.text('barcode')).toBe('8690000000001');
  });

  it('decodes Excel escapes in display text while text of the same cell stays raw', () => {
    const escaped = createRowReader(SPEC, LAYOUT, ['Tisort_x000a_Pamuk'], { toInstant });
    expect(escaped.displayText('barcode')).toBe('Tisort\nPamuk');
    expect(escaped.text('barcode')).toBe('Tisort_x000a_Pamuk');
    expect(reader.displayText('barcode')).toBe('8690000000001');
  });

  it('reads decimals with the grammar of the locator', () => {
    expect(reader.decimal('price')).toBe('250');
    expect(reader.decimal('plainPrice')).toBeNull();
    expect(
      createRowReader(SPEC, LAYOUT, ['x', 'x', '12.5'], { toInstant }).decimal('plainPrice'),
    ).toBe('12.5');
  });

  it('reads integers in the given mode', () => {
    expect(reader.int('stock', 'strict')).toBe(7);
    expect(reader.int('stock', 'truncate')).toBe(7);
    const fractional = createRowReader(SPEC, LAYOUT, ['x', 'x', 'x', 12.9], { toInstant });
    expect(fractional.int('stock', 'truncate')).toBe(12);
    expect(fractional.int('stock', 'strict')).toBeNull();
  });

  it('reads flags with the given rule', () => {
    expect(reader.flag('active', { yes: 'var', compare: 'casefold-tr' })).toBe(true);
    expect(reader.flag('active', { yes: 'var', compare: 'exact' })).toBe(false);
    expect(reader.flag('active', { yes: 'VAR', compare: 'exact' })).toBe(true);
  });

  it('reads a numeric flag as a non-zero truncated integer', () => {
    expect(reader.numericFlag('cancelled')).toBe(true);
    const zero = createRowReader(SPEC, LAYOUT, ['x', 'x', 'x', 'x', 0], { toInstant });
    expect(zero.numericFlag('cancelled')).toBe(false);
  });

  it('reads an instant through the injected conversion', () => {
    expect(reader.instant('window', 'dd/MM/yyyy HH:mm')).toEqual(
      new Date(Date.UTC(2026, 10, 5, 11, 30)),
    );
  });

  it('gives null or false on an absent column', () => {
    const convert = vi.fn(toInstant);
    const absent = createRowReader(SPEC, LAYOUT, ROW, { toInstant: convert });
    expect(LAYOUT.columns.get('brand')).toBeNull();
    expect(absent.text('brand')).toBeNull();
    expect(absent.displayText('brand')).toBeNull();
    expect(absent.decimal('brand')).toBeNull();
    expect(absent.int('brand', 'truncate')).toBeNull();
    expect(absent.int('brand', 'strict')).toBeNull();
    expect(absent.flag('brand', { yes: 'var', compare: 'casefold-tr' })).toBe(false);
    expect(absent.numericFlag('brand')).toBe(false);
    expect(absent.instant('brand', 'dd/MM/yyyy HH:mm')).toBeNull();
    expect(convert).not.toHaveBeenCalled();
  });

  it('gives null or false on a row shorter than the column', () => {
    const short = createRowReader(SPEC, LAYOUT, ['8690000000001'], { toInstant });
    expect(short.text('price')).toBeNull();
    expect(short.displayText('price')).toBeNull();
    expect(short.decimal('price')).toBeNull();
    expect(short.int('stock', 'strict')).toBeNull();
    expect(short.flag('active', { yes: 'var', compare: 'casefold-tr' })).toBe(false);
    expect(short.numericFlag('cancelled')).toBe(false);
    expect(short.instant('window', 'dd/MM/yyyy HH:mm')).toBeNull();
  });

  it('rejects a misspelled column key at compile time', () => {
    // @ts-expect-error -- 'misspelled' is not a column key of SPEC; package typecheck is the proof.
    expect(reader.text('misspelled')).toBeNull();
  });
});

describe('createRowReader: blocks', () => {
  const reader = createRowReader(SPEC, LAYOUT, ROW, { toInstant });
  const periods = reader.blocks('periods');

  it('gives one reader per block, in column order, with its tag', () => {
    expect(periods.map((period) => period.tag)).toEqual([3, 7]);
    expect(periods.map((period) => period.text('label'))).toEqual([
      '01/11/2026 - 03/11/2026',
      '01/11/2026 - 07/11/2026',
    ]);
  });

  it('reads block columns with the grammar of the block column', () => {
    expect(periods.map((period) => period.decimal('offer'))).toEqual(['99.90', '89.90']);
    expect(periods.map((period) => period.decimal('rate'))).toEqual([null, '12.5']);
  });

  it('reads block lookups with the grammar of the lookup', () => {
    expect(periods.map((period) => period.text('computed'))).toEqual([null, '15 TL']);
    expect(periods.map((period) => period.decimal('computed'))).toEqual([null, '15']);
  });

  it('gives null on a row shorter than the block column', () => {
    const short = createRowReader(SPEC, LAYOUT, ['8690000000001'], { toInstant }).blocks('periods');
    expect(short.map((period) => period.text('label'))).toEqual([null, null]);
    expect(short.map((period) => period.decimal('offer'))).toEqual([null, null]);
    expect(short.map((period) => period.decimal('computed'))).toEqual([null, null]);
  });
});

describe('createRowReader: key types', () => {
  const reader = createRowReader(SPEC, LAYOUT, ROW, { toInstant });

  it('types block names and block keys from the spec', () => {
    expectTypeOf(reader.blocks).parameter(0).toEqualTypeOf<'periods'>();
    const [period] = reader.blocks('periods');
    if (period === undefined) return;
    expectTypeOf(period.text).parameter(0).toEqualTypeOf<'label' | 'offer' | 'rate' | 'computed'>();
  });
});
