import { describe, expect, it } from 'vitest';

import {
  all,
  any,
  block,
  columnIndex,
  defineLayout,
  has,
  header,
  headerWith,
  position,
} from './define';
import { resolveLayout } from './resolve';
import type { BlockSpec, LayoutSpec, ResolvedLayout } from './types';

// Pins the layout builders and the module-load validation of `defineLayout`.

function specWithAnchor(anchor: RegExp, min = 1): LayoutSpec {
  return {
    headerLookahead: 0,
    required: {},
    optional: {},
    blocks: { periods: { anchor, follow: [], columns: {}, lookups: {}, min } },
  };
}

describe('locator builders', () => {
  it('header keeps the names in priority order', () => {
    expect(header('Kampayaya Dahil Edilsin Mi?', 'Kampanyaya Dahil Edilsin Mi?')).toStrictEqual({
      by: 'header',
      names: ['Kampayaya Dahil Edilsin Mi?', 'Kampanyaya Dahil Edilsin Mi?'],
    });
  });

  it('headerWith carries the decimal grammar', () => {
    expect(headerWith(['Price'], { decimal: 'currency' })).toStrictEqual({
      by: 'header',
      names: ['Price'],
      decimal: 'currency',
    });
  });

  it('position omits the sentinel and the grammar when they are not given', () => {
    expect(position(3)).toStrictEqual({ by: 'position', index: 3 });
    expect(position(1, 'BARKOD')).toStrictEqual({ by: 'position', index: 1, sentinel: 'BARKOD' });
    expect(position(2, undefined, { decimal: 'currency' })).toStrictEqual({
      by: 'position',
      index: 2,
      decimal: 'currency',
    });
  });

  it('block returns its spec unchanged', () => {
    const spec = {
      anchor: /^Period \((\d+)\)$/,
      follow: ['Offer'],
      columns: { label: { offset: 0 } },
      lookups: { computed: { template: 'Computed ({tag})' } },
      min: 1,
    };
    expect(block(spec)).toBe(spec);
  });
});

describe('defineLayout', () => {
  it('returns a valid spec unchanged', () => {
    const spec = specWithAnchor(/^(?:Period|Window) \((\d+)\)$/);
    expect(defineLayout(spec)).toBe(spec);
  });

  it('accepts a block with min 0', () => {
    expect(() => defineLayout(specWithAnchor(/^Period \((\d+)\)$/, 0))).not.toThrow();
  });

  it('throws on an anchor with the g flag', () => {
    expect(() => defineLayout(specWithAnchor(/x(\d+)/g))).toThrow(/flag/);
  });

  it('throws on an anchor with the y flag', () => {
    expect(() => defineLayout(specWithAnchor(/x(\d+)/y))).toThrow(/flag/);
  });

  it('throws on an anchor without a capture group', () => {
    expect(() => defineLayout(specWithAnchor(/^Period \(\d+\)$/))).toThrow(/capture group/);
  });

  it('throws on an anchor with two capture groups', () => {
    expect(() => defineLayout(specWithAnchor(/^(Period) \((\d+)\)$/))).toThrow(/capture group/);
  });

  it('throws on a negative min', () => {
    expect(() => defineLayout(specWithAnchor(/^Period \((\d+)\)$/, -1))).toThrow(/min/);
  });

  it('throws on a key that is both required and optional', () => {
    expect(() =>
      defineLayout({
        headerLookahead: 0,
        required: { barcode: header('Barkod') },
        optional: { barcode: header('Barcode') },
        blocks: {},
      }),
    ).toThrow(/barcode/);
  });

  it('throws on a position that is not a non-negative integer', () => {
    for (const index of [-1, 1.5]) {
      expect(() =>
        defineLayout({
          headerLookahead: 0,
          required: { stock: position(index) },
          optional: {},
          blocks: {},
        }),
      ).toThrow(/position/);
    }
  });

  it('throws on a block offset that is not a non-negative integer, or a lookup without {tag}', () => {
    const blockWith = (offset: number, template: string): BlockSpec =>
      block({
        anchor: /^P\((\d+)\)$/,
        follow: [],
        columns: { label: { offset } },
        lookups: { rate: { template } },
        min: 0,
      });
    const layoutWith = (periods: BlockSpec): LayoutSpec => ({
      headerLookahead: 0,
      required: {},
      optional: {},
      blocks: { periods },
    });

    expect(() => defineLayout(layoutWith(blockWith(-1, 'Rate ({tag})')))).toThrow(/offset/);
    expect(() => defineLayout(layoutWith(blockWith(0, 'Rate (7)')))).toThrow(/\{tag\}/);
    expect(() => defineLayout(layoutWith(blockWith(0, 'Rate ({tag})')))).not.toThrow();
  });

  it('throws on a block min that is not a non-negative integer', () => {
    for (const min of [-1, 1.5, Number.NaN]) {
      expect(() =>
        defineLayout({
          headerLookahead: 0,
          required: {},
          optional: {},
          blocks: {
            periods: block({ anchor: /^P\((\d+)\)$/, follow: [], columns: {}, lookups: {}, min }),
          },
        }),
      ).toThrow(/min/);
    }
  });

  it('throws on a block key that is both a block column and a lookup', () => {
    expect(() =>
      defineLayout({
        headerLookahead: 0,
        required: {},
        optional: {},
        blocks: {
          periods: block({
            anchor: /^P\((\d+)\)$/,
            follow: [],
            columns: { rate: { offset: 1 } },
            lookups: { rate: { template: 'Rate ({tag})' } },
            min: 0,
          }),
        },
      }),
    ).toThrow(/rate/);
  });
});

describe('row predicate builders', () => {
  it('has, all and any build the predicate tree', () => {
    expect(
      all(has('barcode', 'text'), any(has('offer24', 'decimal'), has('offer3', 'decimal'))),
    ).toStrictEqual({
      op: 'all',
      of: [
        { op: 'has', col: 'barcode', as: 'text' },
        {
          op: 'any',
          of: [
            { op: 'has', col: 'offer24', as: 'decimal' },
            { op: 'has', col: 'offer3', as: 'decimal' },
          ],
        },
      ],
    });
  });
});

describe('columnIndex', () => {
  const spec = defineLayout({
    headerLookahead: 0,
    required: { barcode: header('Barkod') },
    optional: { brand: header('Marka') },
    blocks: {},
  });
  const resolved = resolveLayout(spec, [['Title', 'Stock', 'Barkod']]);
  const layout: ResolvedLayout = resolved ?? {
    headerRowIndex: 0,
    columns: new Map(),
    blocks: new Map(),
  };

  it('resolves the fixture header row', () => {
    expect(resolved).not.toBeNull();
  });

  it('reads a resolved column', () => {
    expect(columnIndex(spec, layout, 'barcode')).toBe(2);
  });

  it('reads an absent optional column as null', () => {
    expect(columnIndex(spec, layout, 'brand')).toBeNull();
  });

  it('rejects a misspelled key at compile time (package typecheck is the proof)', () => {
    // @ts-expect-error 'barkod' is not a key of this layout
    expect(columnIndex(spec, layout, 'barkod')).toBeNull();
  });
});
