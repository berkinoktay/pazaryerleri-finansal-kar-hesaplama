'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';

/**
 * Returns the warning the commission tariff list client shows after a successful import whose
 * file held product rows with neither a current price nor a commission base price
 * (`unknownCurrentPriceRows` of the import response). Those rows are kept, but their current
 * profit is unknown, so the seller is told once. A toast, like `usePrefilledWarning`: the dialog
 * closes and the page navigates to the new tariff on success, and the toaster survives the
 * navigation.
 *
 * Does nothing for 0, and for `undefined`: only the commission endpoint sends the count, and an
 * API one deploy behind does not send it at all. Not an error toast, so the global error
 * pipeline is not involved.
 */
export function useUnknownPriceWarning(): (unknownCurrentPriceRows: number | undefined) => void {
  const t = useTranslations('campaignUpload');
  return React.useCallback(
    (unknownCurrentPriceRows: number | undefined): void => {
      if (unknownCurrentPriceRows === undefined || unknownCurrentPriceRows <= 0) return;
      toast.warning(t('unknownCurrentPriceWarning', { count: unknownCurrentPriceRows }));
    },
    [t],
  );
}
