// Product status filter i18n coverage guard.
//
// The products advanced filter labels every status option from
// `products.filters.statusOptions.<value>`. The option list is derived from
// the ProductVariantStatus enum plus DELISTED, so a new enum member must not
// ship without labels in BOTH locales (next-intl's typed keys only check
// tr.json), and a renamed value must not leave an orphan label behind.

import { describe, expect, it } from 'vitest';

import { PRODUCT_STATUS_FILTERS } from '@/features/products/lib/products-filter-parsers';

import en from '../../messages/en.json';
import tr from '../../messages/tr.json';

const LOCALES = [
  { locale: 'tr', options: tr.products.filters.statusOptions },
  { locale: 'en', options: en.products.filters.statusOptions },
] as const;

describe('Product status filter i18n coverage', () => {
  it.each(LOCALES)('$locale has a label for every status filter value', ({ options }) => {
    for (const status of PRODUCT_STATUS_FILTERS) {
      const label: unknown = options[status];
      expect(label, `Missing products.filters.statusOptions.${status} label`).toBeTypeOf('string');
      expect(label, `Empty products.filters.statusOptions.${status} label`).not.toBe('');
    }
  });

  it('carries no orphan keys outside the status filter domain', () => {
    for (const { locale, options } of LOCALES) {
      for (const key of Object.keys(options)) {
        expect(
          PRODUCT_STATUS_FILTERS,
          `${locale}: products.filters.statusOptions.${key} has no matching status filter`,
        ).toContain(key);
      }
    }
  });
});
