import { renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { ProductVariantStatus } from '@pazarsync/db/enums';

import { useProductFilterFields } from '@/features/products/hooks/use-product-filter-fields';
import { PRODUCT_FILTER_FIELDS } from '@/features/products/lib/products-filter-fields';
import { PRODUCT_STATUS_FILTERS } from '@/features/products/lib/products-filter-parsers';
import { FORMATS } from '@/i18n/formats';

import trMessages from '../../../messages/tr.json';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider
      locale="tr"
      messages={trMessages}
      formats={FORMATS}
      timeZone="Europe/Istanbul"
    >
      {children}
    </NextIntlClientProvider>
  );
}

describe('useProductFilterFields', () => {
  it('offers every status filter in display order with its catalog label', () => {
    const { result } = renderHook(() => useProductFilterFields(undefined), { wrapper });
    const statusField = result.current.find((field) => field.key === PRODUCT_FILTER_FIELDS.status);

    expect(statusField?.dataType).toBe('enumSingle');
    expect(statusField?.enumValues?.map((option) => option.value)).toEqual([
      ProductVariantStatus.ON_SALE,
      ProductVariantStatus.NOT_ON_SALE,
      ProductVariantStatus.LOCKED,
      ProductVariantStatus.BLACKLISTED,
      ProductVariantStatus.ARCHIVED,
      'DELISTED',
    ]);
    expect(statusField?.enumValues).toEqual(
      PRODUCT_STATUS_FILTERS.map((value) => ({
        value,
        label: trMessages.products.filters.statusOptions[value],
      })),
    );
  });
});
