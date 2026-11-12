import { describe, expect, it } from 'vitest';

import type { SheetData } from '../grid-types';
import { block, defineLayout, header, position } from './define';
import { resolveLayout } from './resolve';
import type { BlockSpec, LayoutSpec, ResolvedLayout } from './types';

// Pins the resolver rules that reproduce the six hand-written Trendyol resolvers
// (apps/api/src/services/*-layout.ts): name-priority aliases, first-match headers,
// unchecked positions, sentinels, anchored blocks with follow checks and lookups.

const PLUS_PERIODS = block({
  anchor: /^Tarih Aral[ıi]ğı \((\d+) Gün\)$/i,
  follow: ['Plus Komisyon Teklifi'],
  columns: { label: { offset: 0 }, offer: { offset: 1 } },
  lookups: { computedCommission: { template: 'Hesaplanan Komisyon ({tag} Gün)' } },
  min: 1,
});

const PLUS_LIKE = defineLayout({
  headerLookahead: 0,
  required: { barcode: header('Barkod') },
  optional: {},
  blocks: { periods: PLUS_PERIODS },
});

function onlyBlock(blocks: BlockSpec): LayoutSpec {
  return { headerLookahead: 0, required: {}, optional: {}, blocks: { periods: blocks } };
}

function resolveHeader(spec: LayoutSpec, headerRow: readonly string[]): ResolvedLayout | null {
  const grid: SheetData = [[...headerRow]];
  return resolveLayout(spec, grid);
}

function mustResolve(spec: LayoutSpec, headerRow: readonly string[]): ResolvedLayout {
  const layout = resolveHeader(spec, headerRow);
  if (layout === null) throw new Error('expected the layout to resolve');
  return layout;
}

describe('resolveLayout: header locators', () => {
  const DISCOUNT_LIKE = defineLayout({
    headerLookahead: 0,
    required: {
      barcode: header('Barkod'),
      included: header('Kampayaya Dahil Edilsin Mi?', 'Kampanyaya Dahil Edilsin Mi?'),
    },
    optional: { brand: header('Marka') },
    blocks: {},
  });

  it('gives name priority: the first name wins even when it sits right of the second', () => {
    const layout = mustResolve(DISCOUNT_LIKE, [
      'Barkod',
      'Kampanyaya Dahil Edilsin Mi?',
      'Kampayaya Dahil Edilsin Mi?',
    ]);
    expect(layout.columns.get('included')).toBe(2);
  });

  it('falls back to the second name when the first is absent', () => {
    const layout = mustResolve(DISCOUNT_LIKE, ['Barkod', 'Kampanyaya Dahil Edilsin Mi?']);
    expect(layout.columns.get('included')).toBe(1);
  });

  it('resolves a duplicated header to its first column', () => {
    const layout = mustResolve(DISCOUNT_LIKE, [
      'Kampayaya Dahil Edilsin Mi?',
      'Barkod',
      'Barkod',
      'Kampayaya Dahil Edilsin Mi?',
    ]);
    expect(layout.columns.get('barcode')).toBe(1);
    expect(layout.columns.get('included')).toBe(0);
  });

  it('matches headers after normalization (spacing, NBSP)', () => {
    const layout = mustResolve(DISCOUNT_LIKE, ['  Barkod ', 'Kampayaya  Dahil Edilsin Mi?']);
    expect(layout.columns.get('barcode')).toBe(0);
    expect(layout.columns.get('included')).toBe(1);
  });

  it('keeps an absent optional column as a null entry', () => {
    const layout = mustResolve(DISCOUNT_LIKE, ['Barkod', 'Kampayaya Dahil Edilsin Mi?']);
    expect(layout.columns.has('brand')).toBe(true);
    expect(layout.columns.get('brand')).toBeNull();
    expect(layout.headerRowIndex).toBe(0);
  });

  it('returns null when a required header is missing', () => {
    expect(resolveHeader(DISCOUNT_LIKE, ['Barkod', 'Marka'])).toBeNull();
  });

  it('returns null for an empty grid when a header is required', () => {
    expect(resolveLayout(DISCOUNT_LIKE, [])).toBeNull();
  });
});

describe('resolveLayout: position locators', () => {
  const COMMISSION_LIKE = defineLayout({
    headerLookahead: 0,
    required: {
      productTitle: position(0),
      barcode: position(1, 'BARKOD'),
      modelCode: position(4, 'MODEL KODU'),
    },
    optional: {},
    blocks: {},
  });

  it('resolves positions and checks their sentinels', () => {
    const layout = mustResolve(COMMISSION_LIKE, [
      'ÜRÜN İSMİ',
      'BARKOD',
      'SATICI STOK KODU',
      'BEDEN',
      'MODEL KODU',
    ]);
    expect(layout.columns.get('productTitle')).toBe(0);
    expect(layout.columns.get('barcode')).toBe(1);
    expect(layout.columns.get('modelCode')).toBe(4);
  });

  it('returns null on a sentinel mismatch', () => {
    expect(
      resolveHeader(COMMISSION_LIKE, [
        'ÜRÜN İSMİ',
        'Barkod',
        'SATICI STOK KODU',
        'BEDEN',
        'MODEL KODU',
      ]),
    ).toBeNull();
  });

  it('returns null when the sentinel position lies past the header row', () => {
    expect(resolveHeader(COMMISSION_LIKE, ['ÜRÜN İSMİ', 'BARKOD'])).toBeNull();
  });

  it('returns null on a sentinel mismatch even for an optional position', () => {
    const spec = defineLayout({
      headerLookahead: 0,
      required: {},
      optional: { barcode: position(1, 'BARKOD') },
      blocks: {},
    });
    expect(resolveHeader(spec, ['ÜRÜN İSMİ', 'Barkod'])).toBeNull();
  });

  it('resolves a position without a sentinel even past the end of the header row', () => {
    const spec = defineLayout({
      headerLookahead: 0,
      required: { stock: position(7) },
      optional: {},
      blocks: {},
    });
    expect(mustResolve(spec, ['ÜRÜN İSMİ', 'BARKOD']).columns.get('stock')).toBe(7);
  });
});

describe('resolveLayout: blocks', () => {
  it('reads the tag as a number and looks up the template with it ("07" finds "7")', () => {
    const layout = mustResolve(PLUS_LIKE, [
      'Barkod',
      'Tarih Aralığı (07 Gün)',
      'Plus Komisyon Teklifi',
      'Hesaplanan Komisyon (7 Gün)',
    ]);
    const periods = layout.blocks.get('periods');
    expect(periods).toHaveLength(1);
    expect(periods?.[0]?.tag).toBe(7);
    expect(periods?.[0]?.anchor).toBe(1);
    expect(periods?.[0]?.columns.get('label')).toBe(1);
    expect(periods?.[0]?.columns.get('offer')).toBe(2);
    expect(periods?.[0]?.lookups.get('computedCommission')).toBe(3);
  });

  it('resolves two anchors to two blocks in column order', () => {
    const layout = mustResolve(PLUS_LIKE, [
      'Barkod',
      'Tarih Aralığı (3 Gün)',
      'Plus Komisyon Teklifi',
      'Tarih Aralığı (4 Gün)',
      'Plus Komisyon Teklifi',
      'Hesaplanan Komisyon (4 Gün)',
      'Hesaplanan Komisyon (3 Gün)',
    ]);
    const periods = layout.blocks.get('periods') ?? [];
    expect(periods.map((p) => p.tag)).toEqual([3, 4]);
    expect(periods.map((p) => p.anchor)).toEqual([1, 3]);
    expect(periods.map((p) => p.columns.get('offer'))).toEqual([2, 4]);
    expect(periods.map((p) => p.lookups.get('computedCommission'))).toEqual([6, 5]);
  });

  it('gives a null lookup when the templated header is absent', () => {
    const layout = mustResolve(PLUS_LIKE, [
      'Barkod',
      'Tarih Aralığı (7 Gün)',
      'Plus Komisyon Teklifi',
    ]);
    expect(layout.blocks.get('periods')?.[0]?.lookups.get('computedCommission')).toBeNull();
  });

  it('returns null for the whole layout when a follow header is broken', () => {
    expect(
      resolveHeader(PLUS_LIKE, [
        'Barkod',
        'Tarih Aralığı (3 Gün)',
        'Plus Komisyon Teklifi',
        'Tarih Aralığı (4 Gün)',
        'Bir Başka Kolon',
      ]),
    ).toBeNull();
  });

  it('returns null when fewer than min blocks are found', () => {
    expect(resolveHeader(PLUS_LIKE, ['Barkod', 'Plus Komisyon Teklifi'])).toBeNull();
  });

  it('allows zero blocks when min is 0', () => {
    const spec = onlyBlock({ ...PLUS_PERIODS, min: 0 });
    expect(mustResolve(spec, ['Barkod']).blocks.get('periods')).toEqual([]);
  });

  it('applies the anchor flags: /i matches both casings but not the dotted-I upper case', () => {
    expect(
      resolveHeader(PLUS_LIKE, ['Barkod', 'Tarih Aralığı (7 Gün)', 'Plus Komisyon Teklifi']),
    ).not.toBeNull();
    expect(
      resolveHeader(PLUS_LIKE, ['Barkod', 'Tarih aralığı (7 Gün)', 'Plus Komisyon Teklifi']),
    ).not.toBeNull();
    expect(
      resolveHeader(PLUS_LIKE, ['Barkod', 'TARİH ARALIĞI (7 GÜN)', 'Plus Komisyon Teklifi']),
    ).toBeNull();
  });

  it('skips an anchor match whose capture group is undefined', () => {
    const spec = onlyBlock({
      anchor: /^Period(?: \((\d+)\))?$/,
      follow: [],
      columns: { label: { offset: 0 } },
      lookups: {},
      min: 0,
    });
    const periods = mustResolve(spec, ['Period', 'Period (3)']).blocks.get('periods') ?? [];
    expect(periods.map((p) => p.tag)).toEqual([3]);
    expect(periods.map((p) => p.anchor)).toEqual([1]);
  });

  it('does not bounds-check block offsets', () => {
    const spec = onlyBlock({
      anchor: /^Tarih aralığı \((\d+) Gün\)$/,
      follow: [],
      columns: { label: { offset: 0 }, comm4: { offset: 4 } },
      lookups: {},
      min: 1,
    });
    const periods = mustResolve(spec, ['BARKOD', 'Tarih aralığı (7 Gün)']).blocks.get('periods');
    expect(periods?.[0]?.columns.get('comm4')).toBe(5);
  });
});

describe('resolveLayout: spec validation', () => {
  it('rejects a spec built by hand that skipped defineLayout', () => {
    const anchor = /^P\((\d)\)$/g;
    const spec: LayoutSpec = {
      headerLookahead: 0,
      required: {},
      optional: {},
      blocks: { periods: { anchor, follow: [], columns: {}, lookups: {}, min: 0 } },
    };
    expect(() => resolveLayout(spec, [['P(1)', 'P(2)']])).toThrow(Error);
  });
});

describe('resolveLayout: non-numeric block tags', () => {
  it('skips an anchor match whose capture is not a number', () => {
    const spec = defineLayout({
      headerLookahead: 0,
      required: {},
      optional: {},
      blocks: {
        periods: block({ anchor: /^K \((\w+)\)$/, follow: [], columns: {}, lookups: {}, min: 0 }),
      },
    });
    const layout = resolveLayout(spec, [['K (abc)', 'K (7)']]);
    expect(layout?.blocks.get('periods')?.map((b) => b.tag)).toEqual([7]);
  });
});
