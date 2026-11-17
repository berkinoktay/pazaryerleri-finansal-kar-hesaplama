'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';

import { WORKBOOK_PAGES } from '@pazarsync/utils';

/** The `campaignUpload` message each tariff page warns with. */
const UNKNOWN_PRICE_WARNING_KEYS = {
  [WORKBOOK_PAGES.COMMISSION_TARIFF]: 'unknownCurrentPriceWarning',
  [WORKBOOK_PAGES.PLUS_COMMISSION_TARIFF]: 'plusUnknownPriceWarning',
} as const;

/** The workbook pages whose import response counts rows with an unknown price. */
export type UnknownPriceWarningPage = keyof typeof UNKNOWN_PRICE_WARNING_KEYS;

/**
 * Returns the warning a tariff list client shows after a successful import whose file held
 * product rows the seller will see with an unknown price (`unknownPriceRows` of the import
 * result). Those rows are kept, but no profit is computed from an unknown price, so the seller
 * is told once, in the page's own words: the commission page names the current price, the Plus
 * page also names the Plus price upper limit. A toast, like `usePrefilledWarning`: the dialog
 * closes and the page navigates to the new tariff on success, and the toaster survives the
 * navigation.
 *
 * Does nothing for 0, and for `undefined`: an API one deploy behind does not send the count.
 * Not an error toast, so the global error pipeline is not involved.
 */
export function useUnknownPriceWarning(
  page: UnknownPriceWarningPage,
): (unknownPriceRows: number | undefined) => void {
  const t = useTranslations('campaignUpload');
  const messageKey = UNKNOWN_PRICE_WARNING_KEYS[page];
  return React.useCallback(
    (unknownPriceRows: number | undefined): void => {
      if (unknownPriceRows === undefined || unknownPriceRows <= 0) return;
      toast.warning(t(messageKey, { count: unknownPriceRows }));
    },
    [t, messageKey],
  );
}
