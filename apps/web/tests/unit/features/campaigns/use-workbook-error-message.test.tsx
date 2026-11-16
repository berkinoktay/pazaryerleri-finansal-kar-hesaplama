import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WORKBOOK_PAGES, type WorkbookPage } from '@pazarsync/utils';

import { useWorkbookErrorMessage } from '@/features/campaigns/hooks/use-workbook-error-message';
import { WORKBOOK_ERROR_BUCKETS } from '@/features/campaigns/lib/workbook-error-bucket';

import trMessages from '../../../../messages/tr.json';
import { problemApiError, validationApiError } from '../../../helpers/api-error';
import { AllProviders } from '../../../helpers/render';

const SHARED = trMessages.campaignUpload.errors;
const PAGE_NAMES = trMessages.campaignUpload.pages;

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
