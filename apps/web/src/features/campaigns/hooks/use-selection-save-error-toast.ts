'use client';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { selectionSaveErrorToast } from '../lib/selection-save-error';

/**
 * The `onError` of a selection save on the commission, Plus, Flash and Advantage detail
 * pages. The global pipeline keeps every `VALIDATION_ERROR` silent and these pages have no
 * form for the selections, so the page says it here and the export does not start: a
 * selection the route cannot export gets its own sentence, any other validation issue the
 * generic one. Every other code is already toasted globally.
 */
export function useSelectionSaveErrorToast(): (error: unknown) => void {
  const t = useTranslations('campaignSelection');
  const tErrors = useTranslations('common.errors');
  return (error) => {
    const toastKind = selectionSaveErrorToast(error);
    if (toastKind === 'selectionRefused') toast.error(t('selectionRefused'));
    if (toastKind === 'generic') toast.error(tErrors('generic'));
  };
}
