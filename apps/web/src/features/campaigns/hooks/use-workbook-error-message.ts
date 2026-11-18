'use client';

import { useTranslations } from 'next-intl';

import {
  BYTES_PER_MB,
  UPLOAD_QUOTA_LIMITS,
  WORKBOOK_PAGES,
  type WorkbookPage,
} from '@pazarsync/utils';

import { extractFileIssue, extractQuotaIssue, type UploadQuotaIssue } from '../lib/upload-error';
import { refusalOf } from '../lib/workbook-error-bucket';
import { WORKBOOK_VERTICALS } from '../lib/workbook-verticals';

/** The file code whose meta can name the page the file belongs to. */
const WRONG_FILE_FOR_PAGE = 'WRONG_FILE_FOR_PAGE';

const WORKBOOK_PAGE_VALUES: readonly string[] = Object.values(WORKBOOK_PAGES);

function isWorkbookPage(value: unknown): value is WorkbookPage {
  return typeof value === 'string' && WORKBOOK_PAGE_VALUES.includes(value);
}

/**
 * Maps an import mutation error to the sentence an upload dialog shows on its dropzone, for
 * one page.
 *
 * A `409 UPLOAD_QUOTA_EXCEEDED` (silenced by the global toast pipeline) is shown with the
 * limit it names: the per-page list limit (`quotaLists`) or the store-wide stored file limit
 * in MB (`quotaBytes`); one without a recognised limit (an older API) gets the general quota
 * sentence `common.errors.UPLOAD_QUOTA_EXCEEDED`.
 *
 * A file issue resolves to a bucket (`refusalOf`), and the page's own sentence for it wins
 * when the page has one (`WORKBOOK_VERTICALS[page].errorOverrides`), otherwise the shared
 * `campaignUpload.errors` sentence is used. A row, column or content refusal that carries its
 * limit is shown with a sentence naming that limit (`tooManyRows`, `tooManyColumns`,
 * `tooMuchContent`); one without a limit (an older API) falls back to the size sentence. The
 * shared row and content sentences advise splitting the file, so a page that keeps one tariff
 * per week overrides them (a column override would get `maxCols` the same way). A `WRONG_FILE_FOR_PAGE` whose
 * meta names another of the six pages says which page the file belongs to.
 *
 * Returns null when there is nothing for the dropzone to show: no error, any other `409` or
 * another problem the global toast pipeline owns, or a `422` whose issues are all on other
 * fields (the dialog lists those itself).
 */
export function useWorkbookErrorMessage(page: WorkbookPage): (error: unknown) => string | null {
  const t = useTranslations();

  const quotaMessage = (quota: UploadQuotaIssue): string => {
    switch (quota.limit) {
      case UPLOAD_QUOTA_LIMITS.LISTS:
        return t('campaignUpload.errors.quotaLists', { maxLists: quota.maxLists });
      case UPLOAD_QUOTA_LIMITS.BYTES:
        return t('campaignUpload.errors.quotaBytes', {
          // A unit conversion for display, not a calculation of money.
          maxMb: Math.floor(quota.maxBytes / BYTES_PER_MB),
        });
      case null:
        return t('common.errors.UPLOAD_QUOTA_EXCEEDED');
      default: {
        const unhandled: never = quota;
        throw new Error(`Unhandled upload quota issue: ${JSON.stringify(unhandled)}`);
      }
    }
  };

  return (error) => {
    const quota = extractQuotaIssue(error);
    if (quota !== null) return quotaMessage(quota);

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

    const refusal = refusalOf(issue);
    const override = WORKBOOK_VERTICALS[page].errorOverrides[refusal.bucket];
    switch (refusal.bucket) {
      case 'tooManyRows':
      case 'tooMuchContent':
        return t(override ?? `campaignUpload.errors.${refusal.bucket}`, {
          maxRows: refusal.maxRows,
        });
      case 'tooManyColumns':
        return t(override ?? 'campaignUpload.errors.tooManyColumns', { maxCols: refusal.maxCols });
      default:
        // The buckets left here take no argument, so their key is built from the bucket.
        return override === undefined ? t(`campaignUpload.errors.${refusal.bucket}`) : t(override);
    }
  };
}
