'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';

import { WORKBOOK_PAGES } from '@pazarsync/utils';

/** The `campaignUpload` message each page warns with about unknown commission percents. */
const UNKNOWN_COMMISSION_WARNING_KEYS = {
  [WORKBOOK_PAGES.COMMISSION_TARIFF]: 'unknownCommissionWarning',
  [WORKBOOK_PAGES.PLUS_COMMISSION_TARIFF]: 'plusUnknownCommissionWarning',
  [WORKBOOK_PAGES.FLASH_PRODUCT_LIST]: 'flashUnknownCommissionWarning',
} as const;

/** The workbook pages whose import response counts rows with an unknown price or commission. */
export type UnknownPriceWarningPage = keyof typeof UNKNOWN_COMMISSION_WARNING_KEYS;

/**
 * The `campaignUpload` message each page warns with about unknown prices. The Flash page has
 * none: its import response counts no unknown price.
 */
const UNKNOWN_PRICE_WARNING_KEYS = {
  [WORKBOOK_PAGES.COMMISSION_TARIFF]: 'unknownCurrentPriceWarning',
  [WORKBOOK_PAGES.PLUS_COMMISSION_TARIFF]: 'plusUnknownPriceWarning',
  [WORKBOOK_PAGES.FLASH_PRODUCT_LIST]: null,
} as const satisfies Record<UnknownPriceWarningPage, string | null>;

/** The two counts of an import result the warning reads; a missing count is 0. */
export interface UnknownValueCounts {
  readonly unknownPriceRows?: number;
  readonly unknownCommissionRows?: number;
}

/**
 * Returns the warning a list client shows after a successful import whose file held product
 * rows the seller will see with an unknown price (`unknownPriceRows` of the import result) or
 * an unknown commission percent (`unknownCommissionRows`). Those rows are kept, but no profit
 * is computed from an unknown value, so the seller is told once, in the page's own words: the
 * commission page names the current price and the current commission, the Plus page also
 * names the Plus price upper limit and the Plus commission offer, the Flash page names only
 * the current commission (it has no price count). When both counts apply, the two sentences
 * are joined into ONE toast. A toast, like `usePrefilledWarning`: the dialog closes and the
 * page navigates to the new record on success, and the toaster survives the navigation.
 *
 * Does nothing when both counts are 0 or `undefined`: an API one deploy behind does not send
 * a count. Not an error toast, so the global error pipeline is not involved.
 */
export function useUnknownPriceWarning(
  page: UnknownPriceWarningPage,
): (counts: UnknownValueCounts) => void {
  const t = useTranslations('campaignUpload');
  const priceKey = UNKNOWN_PRICE_WARNING_KEYS[page];
  const commissionKey = UNKNOWN_COMMISSION_WARNING_KEYS[page];
  return React.useCallback(
    ({ unknownPriceRows = 0, unknownCommissionRows = 0 }: UnknownValueCounts): void => {
      const sentences: string[] = [];
      if (priceKey !== null && unknownPriceRows > 0) {
        sentences.push(t(priceKey, { count: unknownPriceRows }));
      }
      if (unknownCommissionRows > 0) {
        sentences.push(t(commissionKey, { count: unknownCommissionRows }));
      }
      if (sentences.length === 0) return;
      toast.warning(sentences.join(' '));
    },
    [t, priceKey, commissionKey],
  );
}
