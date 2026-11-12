import { describe, expect, it } from 'vitest';

import { extractFileErrorCode, validationIssues } from '@/features/campaigns/lib/upload-error';
import { ApiError, type ProblemDetails } from '@/lib/api-error';

function apiError(status: number, code: string, errors?: ProblemDetails['errors']): ApiError {
  return new ApiError(status, code, 'detail', {
    type: 'about:blank',
    title: 'title',
    status,
    code,
    detail: 'detail',
    errors,
  });
}

const FIELD_ISSUES = [
  { field: 'file', code: 'INVALID_CAMPAIGN_FORMAT' },
  { field: 'trendyolFundingPct', code: 'FUNDING_PCT_OVER_100' },
];

describe('validationIssues', () => {
  it('returns the field issues of a VALIDATION_ERROR', () => {
    expect(validationIssues(apiError(422, 'VALIDATION_ERROR', FIELD_ISSUES))).toEqual(FIELD_ISSUES);
  });

  it('returns no issues for a VALIDATION_ERROR without field issues', () => {
    expect(validationIssues(apiError(422, 'VALIDATION_ERROR'))).toEqual([]);
  });

  it('returns no issues for any other API error, even one carrying issues', () => {
    expect(validationIssues(apiError(409, 'CONFLICT', FIELD_ISSUES))).toEqual([]);
  });

  it('returns no issues for a non-API error or no error', () => {
    expect(validationIssues(new Error('boom'))).toEqual([]);
    expect(validationIssues(null)).toEqual([]);
  });
});

describe('extractFileErrorCode', () => {
  it('picks the file issue out of a VALIDATION_ERROR', () => {
    expect(extractFileErrorCode(apiError(422, 'VALIDATION_ERROR', FIELD_ISSUES))).toBe(
      'INVALID_CAMPAIGN_FORMAT',
    );
  });

  it('is null when the VALIDATION_ERROR has no file issue', () => {
    const issues = [{ field: 'value', code: 'VALUE_REQUIRED' }];
    expect(extractFileErrorCode(apiError(422, 'VALIDATION_ERROR', issues))).toBeNull();
  });

  it('returns PAYLOAD_TOO_LARGE for a 413 problem', () => {
    // The body-limit 413 carries no `errors[]`; the code itself is the file rejection.
    expect(extractFileErrorCode(apiError(413, 'PAYLOAD_TOO_LARGE'))).toBe('PAYLOAD_TOO_LARGE');
  });

  it('is null for any non-validation error', () => {
    expect(extractFileErrorCode(apiError(500, 'INTERNAL_ERROR'))).toBeNull();
    expect(extractFileErrorCode(undefined)).toBeNull();
  });
});
