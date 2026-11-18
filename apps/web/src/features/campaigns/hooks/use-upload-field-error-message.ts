'use client';

import { useTranslations } from 'next-intl';

import { UPLOAD_NAME_MAX_LENGTH } from '@pazarsync/utils';

import { INVALID_COMMISSION_SOURCE } from '../lib/upload-error';

/**
 * Maps a backend field issue code to the sentence the campaign upload and edit dialogs show
 * for it: the list name codes of the API's name rule get their own sentence, and every other
 * code gets one generic sentence. The generic sentence is what a field the dialog has no
 * input for, or a code this build has never heard of, shows instead of nothing. The one owner
 * of the name codes (the config field mapper does not know them) and of the Advantage upload's
 * deleted commission source.
 */
export function useUploadFieldErrorMessage(): (code: string) => string {
  const t = useTranslations('campaignUpload.errors');
  const tSource = useTranslations('productLabelsPage.upload.commissionSource');
  return (code) => {
    switch (code) {
      case INVALID_COMMISSION_SOURCE:
        return tSource('invalid');
      case 'NAME_TOO_LONG':
        return t('nameTooLong', { max: UPLOAD_NAME_MAX_LENGTH });
      case 'NAME_INVALID_CHARACTERS':
        return t('nameInvalidCharacters');
      case 'NAME_REQUIRED':
        return t('nameRequired');
      default:
        return t('field');
    }
  };
}
