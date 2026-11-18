import { describe, expect, it } from 'vitest';

import { UPLOAD_QUOTA_LIMITS } from '@pazarsync/utils';

import {
  extractFileIssue,
  extractQuotaIssue,
  hasInvalidCommissionSource,
  isPositiveLimit,
  unplacedIssues,
  validationIssues,
} from '@/features/campaigns/lib/upload-error';
import { ApiError } from '@/lib/api-error';

import { problemApiError, validationApiError } from '../../../helpers/api-error';

const FIELD_ISSUES = [
  { field: 'file', code: 'WRONG_FILE_FOR_PAGE' },
  { field: 'trendyolFundingPct', code: 'FUNDING_PCT_OVER_100' },
];

/**
 * A 409 whose problem body still carries field issues: the builders give a non-validation
 * problem no `errors`, so this one shape is written out.
 */
function conflictWithIssues(): ApiError {
  return new ApiError(409, 'CONFLICT', 'detail', {
    type: 'about:blank',
    title: 'title',
    status: 409,
    code: 'CONFLICT',
    detail: 'detail',
    errors: FIELD_ISSUES,
  });
}

describe('validationIssues', () => {
  it('returns the field issues of a VALIDATION_ERROR', () => {
    expect(validationIssues(validationApiError(FIELD_ISSUES))).toEqual(FIELD_ISSUES);
  });

  it('returns no issues for a VALIDATION_ERROR without field issues', () => {
    // `problemApiError` leaves `errors` absent, the shape a bare 422 has on the wire.
    expect(validationIssues(problemApiError(422, 'VALIDATION_ERROR'))).toEqual([]);
  });

  it('returns no issues for any other API error, even one carrying issues', () => {
    expect(validationIssues(conflictWithIssues())).toEqual([]);
  });

  it('returns no issues for a non-API error or no error', () => {
    expect(validationIssues(new Error('boom'))).toEqual([]);
    expect(validationIssues(null)).toEqual([]);
  });
});

describe('unplacedIssues', () => {
  it('returns the name issue when only the file has a message slot', () => {
    const error = validationApiError([{ field: 'name', code: 'NAME_TOO_LONG' }]);
    expect(unplacedIssues(error, ['file'])).toEqual([{ field: 'name', code: 'NAME_TOO_LONG' }]);
  });

  it('returns no issues when every issue has a message slot', () => {
    expect(
      unplacedIssues(validationApiError(FIELD_ISSUES), ['file', 'trendyolFundingPct']),
    ).toEqual([]);
  });

  it('returns no issues for a 409, even one carrying issues', () => {
    expect(unplacedIssues(conflictWithIssues(), ['file'])).toEqual([]);
    expect(unplacedIssues(problemApiError(409, 'IMPORT_IN_PROGRESS'), ['file'])).toEqual([]);
  });

  it('returns no issues for a plain Error', () => {
    expect(unplacedIssues(new Error('boom'), ['file'])).toEqual([]);
  });
});

describe('extractFileIssue', () => {
  it('picks the file issue out of a VALIDATION_ERROR, with an empty meta when it has none', () => {
    expect(extractFileIssue(validationApiError(FIELD_ISSUES))).toEqual({
      code: 'WRONG_FILE_FOR_PAGE',
      meta: {},
    });
  });

  it("returns the file issue's meta", () => {
    const meta = {
      detectedFormatId: 'TRENDYOL:FLASH_PRODUCT_LIST:v1',
      detectedPlatform: 'TRENDYOL',
      detectedPage: 'FLASH_PRODUCT_LIST',
    };
    const error = validationApiError([{ field: 'file', code: 'WRONG_FILE_FOR_PAGE', meta }]);

    expect(extractFileIssue(error)).toEqual({ code: 'WRONG_FILE_FOR_PAGE', meta });
  });

  it('is null when the VALIDATION_ERROR has no file issue', () => {
    const issues = [{ field: 'value', code: 'VALUE_REQUIRED' }];
    expect(extractFileIssue(validationApiError(issues))).toBeNull();
  });

  it('returns PAYLOAD_TOO_LARGE with an empty meta for a 413 problem', () => {
    // The body-limit 413 carries no `errors[]`; the code itself is the file rejection.
    expect(extractFileIssue(problemApiError(413, 'PAYLOAD_TOO_LARGE'))).toEqual({
      code: 'PAYLOAD_TOO_LARGE',
      meta: {},
    });
  });

  it('is null for any non-validation error', () => {
    expect(extractFileIssue(problemApiError(500, 'INTERNAL_ERROR'))).toBeNull();
    expect(extractFileIssue(problemApiError(409, 'IMPORT_IN_PROGRESS'))).toBeNull();
    expect(extractFileIssue(undefined)).toBeNull();
  });
});

describe('extractQuotaIssue', () => {
  const QUOTA = 'UPLOAD_QUOTA_EXCEEDED';
  const MAX_LISTS = 50;
  const MAX_BYTES = 200 * 1024 * 1024;

  it('reads the per-page list limit', () => {
    const error = problemApiError(409, QUOTA, {
      limit: UPLOAD_QUOTA_LIMITS.LISTS,
      maxLists: MAX_LISTS,
    });
    expect(extractQuotaIssue(error)).toEqual({
      limit: UPLOAD_QUOTA_LIMITS.LISTS,
      maxLists: MAX_LISTS,
    });
  });

  it('reads the store-wide stored file limit', () => {
    const error = problemApiError(409, QUOTA, {
      limit: UPLOAD_QUOTA_LIMITS.BYTES,
      maxBytes: MAX_BYTES,
    });
    expect(extractQuotaIssue(error)).toEqual({
      limit: UPLOAD_QUOTA_LIMITS.BYTES,
      maxBytes: MAX_BYTES,
    });
  });

  it('names no limit for a quota refusal without meta', () => {
    expect(extractQuotaIssue(problemApiError(409, QUOTA))).toEqual({ limit: null });
  });

  it('names no limit when the maximum is not a number', () => {
    const error = problemApiError(409, QUOTA, {
      limit: UPLOAD_QUOTA_LIMITS.LISTS,
      maxLists: '50',
    });
    expect(extractQuotaIssue(error)).toEqual({ limit: null });
  });

  it('is null for any other error', () => {
    expect(extractQuotaIssue(problemApiError(409, 'IMPORT_IN_PROGRESS'))).toBeNull();
    expect(extractQuotaIssue(validationApiError(FIELD_ISSUES))).toBeNull();
    expect(extractQuotaIssue(new Error('boom'))).toBeNull();
  });
});

describe('hasInvalidCommissionSource', () => {
  it('is true for the commission source field refused as deleted', () => {
    const error = validationApiError([
      { field: 'file', code: 'WRONG_FILE_FOR_PAGE' },
      { field: 'commissionSourceTariffId', code: 'INVALID_COMMISSION_SOURCE' },
    ]);
    expect(hasInvalidCommissionSource(error)).toBe(true);
  });

  it('is false for another code on the same field, or the same code on another field', () => {
    expect(
      hasInvalidCommissionSource(
        validationApiError([{ field: 'commissionSourceTariffId', code: 'REQUIRED' }]),
      ),
    ).toBe(false);
    expect(
      hasInvalidCommissionSource(
        validationApiError([{ field: 'file', code: 'INVALID_COMMISSION_SOURCE' }]),
      ),
    ).toBe(false);
  });

  it('is false for an error that is not a validation error', () => {
    expect(hasInvalidCommissionSource(problemApiError(409, 'CONFLICT'))).toBe(false);
    expect(hasInvalidCommissionSource(new Error('boom'))).toBe(false);
  });
});

describe('isPositiveLimit', () => {
  it('accepts a positive finite number', () => {
    expect(isPositiveLimit(5000)).toBe(true);
    expect(isPositiveLimit(0.5)).toBe(true);
  });

  it.each([0, -1, Number.POSITIVE_INFINITY, Number.NaN, '5000', null, undefined])(
    'refuses %s',
    (value) => {
      expect(isPositiveLimit(value)).toBe(false);
    },
  );
});
