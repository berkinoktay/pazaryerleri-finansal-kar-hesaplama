'use client';

import { useTranslations } from 'next-intl';

import { UPLOAD_NAME_MAX_LENGTH } from '@pazarsync/utils';

/**
 * Maps a backend field issue code to the sentence the campaign upload and edit dialogs show
 * for it: the list name codes of the API's name rule get their own sentence, and every other
 * code gets one generic sentence. The generic sentence is what a field the dialog has no
 * input for, or a code this build has never heard of, shows instead of nothing. The one owner
 * of the name codes: the config field mapper does not know them.
 */
export function useUploadFieldErrorMessage(): (code: string) => string {
  const t = useTranslations('campaignUpload.errors');
  return (code) => {
    switch (code) {
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
