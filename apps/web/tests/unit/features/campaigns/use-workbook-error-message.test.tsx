import { renderHook } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import {
  UPLOAD_QUOTA_LIMITS,
  WORKBOOK_FILE_LIMITS,
  WORKBOOK_PAGES,
  type WorkbookPage,
} from '@pazarsync/utils';

import { useWorkbookErrorMessage } from '@/features/campaigns/hooks/use-workbook-error-message';
import { WORKBOOK_ERROR_BUCKETS } from '@/features/campaigns/lib/workbook-error-bucket';
import { FORMATS } from '@/i18n/formats';

import trMessages from '../../../../messages/tr.json';
import { problemApiError, validationApiError } from '../../../helpers/api-error';
import { AllProviders } from '../../../helpers/render';

const SHARED = trMessages.campaignUpload.errors;
const PAGE_NAMES = trMessages.campaignUpload.pages;

// A sentence with a limit is built from the catalog with the provider's formats, never typed.
const tErrors = createTranslator({
  locale: 'tr',
  messages: trMessages,
  namespace: 'campaignUpload.errors',
  formats: FORMATS,
});

// A page's own sentence lives outside `campaignUpload.errors`, so it is built from the root.
const tRoot = createTranslator({ locale: 'tr', messages: trMessages, formats: FORMATS });

/** The row and content sentences of the pages that keep one tariff per week. */
type TariffRowSentenceKey =
  | 'commissionTariffsPage.upload.errors.tooManyRows'
  | 'commissionTariffsPage.upload.errors.tooMuchContent'
  | 'plusCommissionTariffsPage.upload.errors.tooManyRows'
  | 'plusCommissionTariffsPage.upload.errors.tooMuchContent';

type RowLimitBucket = 'tooManyRows' | 'tooMuchContent';

const MAX_ROWS = 5000;
const MAX_COLS = 64;
const MAX_LISTS = 50;
const QUOTA_MB = 200;
// Written out rather than built from BYTES_PER_MB, so the hook's conversion is checked.
const QUOTA_BYTES = 200 * 1024 * 1024;

/** The message function the hook returns for one page, under the real Turkish messages. */
function messageFor(page: WorkbookPage): (error: unknown) => string | null {
  const { result } = renderHook(() => useWorkbookErrorMessage(page), { wrapper: AllProviders });
  return result.current;
}

/** A 422 whose only issue is on `file`, with an optional meta. */
function fileIssue(code: string, meta?: Record<string, unknown>): Error {
  return validationApiError([
    meta === undefined ? { field: 'file', code } : { field: 'file', code, meta },
  ]);
}

/** Every string leaf of a messages tree, so a result can be proven a real message. */
function stringLeaves(node: unknown, into: Set<string> = new Set()): Set<string> {
  if (typeof node === 'string') {
    into.add(node);
    return into;
  }
  if (typeof node === 'object' && node !== null) {
    for (const child of Object.values(node)) stringLeaves(child, into);
  }
  return into;
}

const MESSAGE_LEAVES = stringLeaves(trMessages);

/** The text of `wrongFormatDetected` with the page name filled in. */
function detectedSentence(pageName: string): string {
  return SHARED.wrongFormatDetected.replace('{page}', pageName);
}

describe('useWorkbookErrorMessage', () => {
  it('answers the shared sentence for a bucket the page does not override', () => {
    expect(messageFor(WORKBOOK_PAGES.DISCOUNT_LIST)(fileIssue('EMPTY_FILE'))).toBe(SHARED.empty);
  });

  it("answers the page's own sentence for a bucket the page overrides", () => {
    expect(messageFor(WORKBOOK_PAGES.FLASH_PRODUCT_LIST)(fileIssue('EMPTY_FILE'))).toBe(
      trMessages.flashProductsPage.upload.errors.empty,
    );
    expect(messageFor(WORKBOOK_PAGES.PLUS_COMMISSION_TARIFF)(fileIssue('DUPLICATE_WEEK'))).toBe(
      trMessages.plusCommissionTariffsPage.upload.errors.duplicateWeek,
    );
  });

  it('answers the unsafe sentence for UNSAFE_CONTENT', () => {
    expect(messageFor(WORKBOOK_PAGES.DISCOUNT_LIST)(fileIssue('UNSAFE_CONTENT'))).toBe(
      SHARED.unsafe,
    );
  });

  it('names the detected page of a WRONG_FILE_FOR_PAGE', () => {
    const message = messageFor(WORKBOOK_PAGES.DISCOUNT_LIST)(
      fileIssue('WRONG_FILE_FOR_PAGE', {
        detectedFormatId: 'TRENDYOL:FLASH_PRODUCT_LIST:v1',
        detectedPlatform: 'TRENDYOL',
        detectedPage: 'FLASH_PRODUCT_LIST',
      }),
    );

    expect(message).toBe(detectedSentence(PAGE_NAMES.FLASH_PRODUCT_LIST));
  });

  it.each<[string, Record<string, unknown> | undefined]>([
    ['a null detected page', { detectedPage: null }],
    ['no meta', undefined],
    ['a meta without a detected page', { detectedFormatId: null }],
    ['an unknown detected page', { detectedPage: 'HEPSIBURADA_SOMETHING' }],
    ['the page itself as the detected page', { detectedPage: 'DISCOUNT_LIST' }],
  ])("answers the page's wrong-format sentence for %s", (_label, meta) => {
    const message = messageFor(WORKBOOK_PAGES.DISCOUNT_LIST)(
      fileIssue('WRONG_FILE_FOR_PAGE', meta),
    );

    expect(message).toBe(trMessages.discountsPage.upload.errors.wrongFormat);
    expect(message).not.toContain('undefined');
  });

  it('answers the generic sentence for a file code this build has never heard of', () => {
    expect(messageFor(WORKBOOK_PAGES.DISCOUNT_LIST)(fileIssue('SOME_FUTURE_CODE'))).toBe(
      SHARED.generic,
    );
  });

  it('answers the too-large sentence for the 413', () => {
    expect(
      messageFor(WORKBOOK_PAGES.DISCOUNT_LIST)(problemApiError(413, 'PAYLOAD_TOO_LARGE')),
    ).toBe(SHARED.tooLarge);
  });

  it('names the row limit of a row cap refusal', () => {
    expect(
      messageFor(WORKBOOK_PAGES.DISCOUNT_LIST)(
        fileIssue('ROW_CAP_EXCEEDED', { maxRows: MAX_ROWS }),
      ),
    ).toBe(tErrors('tooManyRows', { maxRows: MAX_ROWS }));
  });

  it('names the column limit of a column cap refusal', () => {
    expect(
      messageFor(WORKBOOK_PAGES.COMMISSION_TARIFF)(
        fileIssue('COL_CAP_EXCEEDED', { maxCols: MAX_COLS }),
      ),
    ).toBe(tErrors('tooManyColumns', { maxCols: MAX_COLS }));
  });

  it('names the row limit of a content refusal about filled rows', () => {
    expect(
      messageFor(WORKBOOK_PAGES.DISCOUNT_LIST)(
        fileIssue('PAYLOAD_TOO_LARGE', { limit: WORKBOOK_FILE_LIMITS.ROWS, maxRows: MAX_ROWS }),
      ),
    ).toBe(tErrors('tooMuchContent', { maxRows: MAX_ROWS }));
  });

  // A tariff page keeps one file per week (DUPLICATE_WEEK), so the shared advice to split the
  // file would leave the seller with half a tariff: these pages answer their own sentence.
  it.each<[WorkbookPage, string, Record<string, unknown>, TariffRowSentenceKey, RowLimitBucket]>([
    [
      WORKBOOK_PAGES.COMMISSION_TARIFF,
      'ROW_CAP_EXCEEDED',
      { maxRows: MAX_ROWS },
      'commissionTariffsPage.upload.errors.tooManyRows',
      'tooManyRows',
    ],
    [
      WORKBOOK_PAGES.COMMISSION_TARIFF,
      'PAYLOAD_TOO_LARGE',
      { limit: WORKBOOK_FILE_LIMITS.ROWS, maxRows: MAX_ROWS },
      'commissionTariffsPage.upload.errors.tooMuchContent',
      'tooMuchContent',
    ],
    [
      WORKBOOK_PAGES.PLUS_COMMISSION_TARIFF,
      'ROW_CAP_EXCEEDED',
      { maxRows: MAX_ROWS },
      'plusCommissionTariffsPage.upload.errors.tooManyRows',
      'tooManyRows',
    ],
    [
      WORKBOOK_PAGES.PLUS_COMMISSION_TARIFF,
      'PAYLOAD_TOO_LARGE',
      { limit: WORKBOOK_FILE_LIMITS.ROWS, maxRows: MAX_ROWS },
      'plusCommissionTariffsPage.upload.errors.tooMuchContent',
      'tooMuchContent',
    ],
  ])(
    "%s answers the page's own sentence for %s, without the shared advice to split the file",
    (page, code, meta, pageKey, sharedKey) => {
      const message = messageFor(page)(fileIssue(code, meta));

      expect(message).toBe(tRoot(pageKey, { maxRows: MAX_ROWS }));
      expect(message).not.toBe(tErrors(sharedKey, { maxRows: MAX_ROWS }));
    },
  );

  it('answers the too-large sentence for a size refusal on the file', () => {
    expect(messageFor(WORKBOOK_PAGES.COMMISSION_TARIFF)(fileIssue('PAYLOAD_TOO_LARGE'))).toBe(
      SHARED.tooLarge,
    );
  });

  it('answers the too-large sentence for a row cap refusal without its limit', () => {
    expect(messageFor(WORKBOOK_PAGES.COMMISSION_TARIFF)(fileIssue('ROW_CAP_EXCEEDED'))).toBe(
      SHARED.tooLarge,
    );
  });

  it('names the per-page list limit of a quota refusal', () => {
    expect(
      messageFor(WORKBOOK_PAGES.DISCOUNT_LIST)(
        problemApiError(409, 'UPLOAD_QUOTA_EXCEEDED', {
          limit: UPLOAD_QUOTA_LIMITS.LISTS,
          maxLists: MAX_LISTS,
        }),
      ),
    ).toBe(tErrors('quotaLists', { maxLists: MAX_LISTS }));
  });

  it('names the stored file limit of a quota refusal in MB', () => {
    expect(
      messageFor(WORKBOOK_PAGES.DISCOUNT_LIST)(
        problemApiError(409, 'UPLOAD_QUOTA_EXCEEDED', {
          limit: UPLOAD_QUOTA_LIMITS.BYTES,
          maxBytes: QUOTA_BYTES,
        }),
      ),
    ).toBe(tErrors('quotaBytes', { maxMb: QUOTA_MB }));
  });

  it('answers the general quota sentence for a quota refusal without a limit', () => {
    expect(
      messageFor(WORKBOOK_PAGES.DISCOUNT_LIST)(problemApiError(409, 'UPLOAD_QUOTA_EXCEEDED')),
    ).toBe(trMessages.common.errors.UPLOAD_QUOTA_EXCEEDED);
  });

  it('answers nothing for no error, a 409 and a 422 without a file issue', () => {
    const message = messageFor(WORKBOOK_PAGES.DISCOUNT_LIST);

    expect(message(null)).toBeNull();
    expect(message(problemApiError(409, 'IMPORT_IN_PROGRESS'))).toBeNull();
    expect(message(validationApiError([{ field: 'name', code: 'NAME_TOO_LONG' }]))).toBeNull();
  });

  it.each(Object.values(WORKBOOK_PAGES))(
    '%s answers a real message for every file code',
    (page) => {
      const message = messageFor(page);

      for (const code of Object.keys(WORKBOOK_ERROR_BUCKETS)) {
        // next-intl answers the key path itself for a missing key, so a non-empty check would
        // pass for a typo; the result must be one of the catalog's own sentences.
        const result = message(fileIssue(code));
        expect({ code, real: MESSAGE_LEAVES.has(result ?? '') }).toEqual({ code, real: true });
      }
    },
  );
});
