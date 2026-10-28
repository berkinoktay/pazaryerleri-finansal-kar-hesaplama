import { describe, expect, it } from 'vitest';

import { ProductVariantStatus } from '@pazarsync/db/enums';

import {
  isKnownStatusReason,
  KNOWN_STATUS_REASONS,
  variantStatusBadgeKind,
  type VariantStatusBadgeKind,
} from '@/features/products/lib/variant-status';

import en from '../../../../messages/en.json';
import tr from '../../../../messages/tr.json';

function kindOf(status: ProductVariantStatus, quantity: number): VariantStatusBadgeKind | null {
  return variantStatusBadgeKind({ status, quantity });
}

const STOCK_INDEPENDENT_KINDS: ReadonlyArray<{
  status: ProductVariantStatus;
  kind: VariantStatusBadgeKind;
}> = [
  { status: ProductVariantStatus.LOCKED, kind: 'locked' },
  { status: ProductVariantStatus.BLACKLISTED, kind: 'blacklisted' },
  { status: ProductVariantStatus.ARCHIVED, kind: 'archived' },
];

describe('variantStatusBadgeKind', () => {
  it('returns no badge for an on-sale variant whatever its stock', () => {
    expect(kindOf(ProductVariantStatus.ON_SALE, 0)).toBeNull();
    expect(kindOf(ProductVariantStatus.ON_SALE, 12)).toBeNull();
  });

  it('splits a not-on-sale variant into out of stock and closed by its stock', () => {
    expect(kindOf(ProductVariantStatus.NOT_ON_SALE, 0)).toBe('outOfStock');
    expect(kindOf(ProductVariantStatus.NOT_ON_SALE, 1)).toBe('closed');
    expect(kindOf(ProductVariantStatus.NOT_ON_SALE, 40)).toBe('closed');
  });

  it.each(STOCK_INDEPENDENT_KINDS)(
    'maps $status to $kind whatever its stock',
    ({ status, kind }) => {
      expect(kindOf(status, 0)).toBe(kind);
      expect(kindOf(status, 7)).toBe(kind);
    },
  );
});

describe('isKnownStatusReason', () => {
  it.each(KNOWN_STATUS_REASONS)('accepts the known code %s', (code) => {
    expect(isKnownStatusReason(code)).toBe(true);
  });

  it.each([null, '', '   ', 'critical_sale_price_change', 'SOME_FUTURE_REASON'])(
    'rejects %j',
    (value) => {
      expect(isKnownStatusReason(value)).toBe(false);
    },
  );
});

const CATALOGS = [
  { locale: 'tr', products: tr.products },
  { locale: 'en', products: en.products },
];

describe('variant status i18n coverage', () => {
  it.each(CATALOGS)('$locale has a reason sentence for exactly the known codes', ({ products }) => {
    expect(Object.keys(products.statusReasons).sort()).toEqual([...KNOWN_STATUS_REASONS].sort());
    for (const code of KNOWN_STATUS_REASONS) {
      expect(products.statusReasons[code], `products.statusReasons.${code}`).toMatch(/\S/);
    }
  });

  it.each(CATALOGS)(
    '$locale has a label for every badge kind the mapper returns',
    ({ products }) => {
      expect(Object.keys(products.statusBadge).sort()).toEqual([
        'archived',
        'blacklisted',
        'closed',
        'locked',
        'outOfStock',
        'reasonAria',
        'reasonTitle',
      ]);
      for (const status of Object.values(ProductVariantStatus)) {
        for (const quantity of [0, 1]) {
          const kind = kindOf(status, quantity);
          if (kind === null) continue;
          expect(products.statusBadge[kind], `products.statusBadge.${kind}`).toMatch(/\S/);
        }
      }
      expect(products.statusBadge.reasonTitle).toMatch(/\S/);
      expect(products.statusBadge.reasonAria).toContain('{label}');
    },
  );
});
