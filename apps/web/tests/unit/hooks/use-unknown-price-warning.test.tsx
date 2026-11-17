import { renderHook } from '@testing-library/react';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import { type ReactElement, type ReactNode } from 'react';
import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WORKBOOK_PAGES } from '@pazarsync/utils';

import {
  type UnknownPriceWarningPage,
  useUnknownPriceWarning,
} from '@/features/campaigns/hooks/use-unknown-price-warning';

import trMessages from '../../../messages/tr.json';

const UNKNOWN_PRICE_ROWS = 4;
const UNKNOWN_COMMISSION_ROWS = 2;

// The expected warning is built from the catalog with the same plural, never typed.
const tUpload = createTranslator({
  locale: 'tr',
  messages: trMessages,
  namespace: 'campaignUpload',
});

function wrapper({ children }: { children: ReactNode }): ReactElement {
  return (
    <NextIntlClientProvider locale="tr" messages={trMessages}>
      {children}
    </NextIntlClientProvider>
  );
}

function renderWarning(page: UnknownPriceWarningPage) {
  return renderHook(() => useUnknownPriceWarning(page), { wrapper });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useUnknownPriceWarning', () => {
  it('warns once with the count of rows whose current price was unknown', () => {
    const warning = vi.spyOn(toast, 'warning');
    const { result } = renderWarning(WORKBOOK_PAGES.COMMISSION_TARIFF);

    result.current({ unknownPriceRows: UNKNOWN_PRICE_ROWS });

    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(
      tUpload('unknownCurrentPriceWarning', { count: UNKNOWN_PRICE_ROWS }),
    );
  });

  it('does nothing for 0', () => {
    const warning = vi.spyOn(toast, 'warning');
    const { result } = renderWarning(WORKBOOK_PAGES.COMMISSION_TARIFF);

    result.current({ unknownPriceRows: 0 });

    expect(warning).not.toHaveBeenCalled();
  });

  it('does nothing when the API does not send the count', () => {
    const warning = vi.spyOn(toast, 'warning');
    const { result } = renderWarning(WORKBOOK_PAGES.COMMISSION_TARIFF);

    result.current({ unknownPriceRows: undefined });

    expect(warning).not.toHaveBeenCalled();
  });

  it('warns with the Plus message for the Plus page', () => {
    const warning = vi.spyOn(toast, 'warning');
    const { result } = renderWarning(WORKBOOK_PAGES.PLUS_COMMISSION_TARIFF);

    result.current({ unknownPriceRows: UNKNOWN_PRICE_ROWS });

    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(
      tUpload('plusUnknownPriceWarning', { count: UNKNOWN_PRICE_ROWS }),
    );
  });

  it('warns with the commission sentence alone', () => {
    const warning = vi.spyOn(toast, 'warning');
    const { result } = renderWarning(WORKBOOK_PAGES.COMMISSION_TARIFF);

    result.current({ unknownPriceRows: 0, unknownCommissionRows: UNKNOWN_COMMISSION_ROWS });

    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(
      tUpload('unknownCommissionWarning', { count: UNKNOWN_COMMISSION_ROWS }),
    );
  });

  it('joins both sentences into one toast', () => {
    const warning = vi.spyOn(toast, 'warning');
    const { result } = renderWarning(WORKBOOK_PAGES.PLUS_COMMISSION_TARIFF);

    result.current({
      unknownPriceRows: UNKNOWN_PRICE_ROWS,
      unknownCommissionRows: UNKNOWN_COMMISSION_ROWS,
    });

    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(
      [
        tUpload('plusUnknownPriceWarning', { count: UNKNOWN_PRICE_ROWS }),
        tUpload('plusUnknownCommissionWarning', { count: UNKNOWN_COMMISSION_ROWS }),
      ].join(' '),
    );
  });

  it('warns with the Flash sentence on the Flash page', () => {
    const warning = vi.spyOn(toast, 'warning');
    const { result } = renderWarning(WORKBOOK_PAGES.FLASH_PRODUCT_LIST);

    // The Flash page has no price sentence, so a price count adds nothing to the toast.
    result.current({
      unknownPriceRows: UNKNOWN_PRICE_ROWS,
      unknownCommissionRows: UNKNOWN_COMMISSION_ROWS,
    });

    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(
      tUpload('flashUnknownCommissionWarning', { count: UNKNOWN_COMMISSION_ROWS }),
    );
  });

  it('does nothing for zero or missing counts', () => {
    const warning = vi.spyOn(toast, 'warning');
    const pages: readonly UnknownPriceWarningPage[] = [
      WORKBOOK_PAGES.COMMISSION_TARIFF,
      WORKBOOK_PAGES.PLUS_COMMISSION_TARIFF,
      WORKBOOK_PAGES.FLASH_PRODUCT_LIST,
    ];

    for (const page of pages) {
      const { result } = renderWarning(page);
      result.current({});
      result.current({ unknownPriceRows: 0, unknownCommissionRows: 0 });
      result.current({ unknownPriceRows: undefined, unknownCommissionRows: undefined });
    }
    // The Flash page has no price sentence: a price count alone shows nothing there.
    renderWarning(WORKBOOK_PAGES.FLASH_PRODUCT_LIST).result.current({
      unknownPriceRows: UNKNOWN_PRICE_ROWS,
    });

    expect(warning).not.toHaveBeenCalled();
  });
});
