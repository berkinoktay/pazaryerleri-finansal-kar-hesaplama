'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';

/**
 * Returns the warning a list client shows after a successful workbook import whose file
 * arrived with choices already filled in (`prefilledRows` of the import response). Those
 * choices were not read as the seller's, and they stay in the exported file unless the seller
 * chooses for those products, so the seller is told once. A toast, not an inline line: the
 * dialog closes and the page navigates to the new list on success, and the toaster survives
 * the navigation.
 *
 * Does nothing for 0, and for `undefined`: an API one deploy behind does not send the count.
 * Not an error toast, so the global error pipeline is not involved.
 */
export function usePrefilledWarning(): (prefilledRows: number | undefined) => void {
  const t = useTranslations('campaignUpload');
  return React.useCallback(
    (prefilledRows: number | undefined): void => {
      if (prefilledRows === undefined || prefilledRows <= 0) return;
      toast.warning(t('prefilledWarning', { count: prefilledRows }));
    },
    [t],
  );
}
