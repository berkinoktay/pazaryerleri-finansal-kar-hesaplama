import { renderHook } from '@testing-library/react';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import { type ReactElement, type ReactNode } from 'react';
import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUnknownPriceWarning } from '@/features/campaigns/hooks/use-unknown-price-warning';

import trMessages from '../../../messages/tr.json';

const UNKNOWN_PRICE_ROWS = 4;

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useUnknownPriceWarning', () => {
  it('warns once with the count of rows whose current price was unknown', () => {
    const warning = vi.spyOn(toast, 'warning');
    const { result } = renderHook(() => useUnknownPriceWarning(), { wrapper });

    result.current(UNKNOWN_PRICE_ROWS);

    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(
      tUpload('unknownCurrentPriceWarning', { count: UNKNOWN_PRICE_ROWS }),
    );
  });

  it('does nothing for 0', () => {
    const warning = vi.spyOn(toast, 'warning');
    const { result } = renderHook(() => useUnknownPriceWarning(), { wrapper });

    result.current(0);

    expect(warning).not.toHaveBeenCalled();
  });

  it('does nothing when the API does not send the count', () => {
    const warning = vi.spyOn(toast, 'warning');
    const { result } = renderHook(() => useUnknownPriceWarning(), { wrapper });

    result.current(undefined);

    expect(warning).not.toHaveBeenCalled();
  });
});
