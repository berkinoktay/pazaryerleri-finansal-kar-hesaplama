import { renderHook } from '@testing-library/react';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import { type ReactElement, type ReactNode } from 'react';
import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { usePrefilledWarning } from '@/features/campaigns/hooks/use-prefilled-warning';

import trMessages from '../../../messages/tr.json';

const PREFILLED_ROWS = 3;

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

describe('usePrefilledWarning', () => {
  it('warns once with the count of the rows the file brought already filled in', () => {
    const warning = vi.spyOn(toast, 'warning');
    const { result } = renderHook(() => usePrefilledWarning(), { wrapper });

    result.current(PREFILLED_ROWS);

    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(tUpload('prefilledWarning', { count: PREFILLED_ROWS }));
  });

  it.each([
    ['0', 0],
    ['undefined (an API one deploy behind)', undefined],
  ])('stays silent for %s', (_label, prefilledRows) => {
    const warning = vi.spyOn(toast, 'warning');
    const { result } = renderHook(() => usePrefilledWarning(), { wrapper });

    result.current(prefilledRows);

    expect(warning).not.toHaveBeenCalled();
  });
});
