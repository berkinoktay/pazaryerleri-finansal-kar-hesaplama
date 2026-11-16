'use client';

import { useTranslations } from 'next-intl';

import { WORKBOOK_PAGES, type WorkbookPage } from '@pazarsync/utils';

import { extractFileIssue } from '../lib/upload-error';
import { bucketOf } from '../lib/workbook-error-bucket';
import { WORKBOOK_VERTICALS } from '../lib/workbook-verticals';

/** The file code whose meta can name the page the file belongs to. */
const WRONG_FILE_FOR_PAGE = 'WRONG_FILE_FOR_PAGE';

const WORKBOOK_PAGE_VALUES: readonly string[] = Object.values(WORKBOOK_PAGES);

function isWorkbookPage(value: unknown): value is WorkbookPage {
  return typeof value === 'string' && WORKBOOK_PAGE_VALUES.includes(value);
}

/**
 * Maps an import mutation error to the sentence an upload dialog shows on its dropzone, for
 * one page. The file code picks a bucket (`bucketOf`); the page's own sentence for that bucket
 * wins when the page has one (`WORKBOOK_VERTICALS[page].errorOverrides`), otherwise the shared
 * `campaignUpload.errors` sentence is used. A `WRONG_FILE_FOR_PAGE` whose meta names another
 * of the six pages says which page the file belongs to.
 *
 * Returns null when there is no file rejection to show: no error, a `409` or another problem
 * the global toast pipeline owns, or a `422` whose issues are all on other fields (the dialog
 * lists those itself).
 */
export function useWorkbookErrorMessage(page: WorkbookPage): (error: unknown) => string | null {
  const t = useTranslations();
  return (error) => {
    const issue = extractFileIssue(error);
    if (issue === null) return null;

    const detectedPage = issue.meta['detectedPage'];
    if (
      issue.code === WRONG_FILE_FOR_PAGE &&
      isWorkbookPage(detectedPage) &&
      detectedPage !== page
    ) {
      return t('campaignUpload.errors.wrongFormatDetected', {
        page: t(`campaignUpload.pages.${detectedPage}`),
      });
    }

    const bucket = bucketOf(issue.code);
    const override = WORKBOOK_VERTICALS[page].errorOverrides[bucket];
    return override === undefined ? t(`campaignUpload.errors.${bucket}`) : t(override);
  };
}
