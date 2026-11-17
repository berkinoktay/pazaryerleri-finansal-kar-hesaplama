import { describe, expect, it } from 'vitest';

import { selectionSaveErrorToast } from '@/features/campaigns/lib/selection-save-error';

import { problemApiError, validationApiError } from '../helpers/api-error';

describe('selectionSaveErrorToast', () => {
  it('returns null for an error that is not an ApiError', () => {
    expect(selectionSaveErrorToast(new Error('boom'))).toBeNull();
    expect(selectionSaveErrorToast(undefined)).toBeNull();
  });

  it('returns null for an ApiError other than VALIDATION_ERROR (the global pipeline toasts it)', () => {
    expect(selectionSaveErrorToast(problemApiError(500, 'INTERNAL_ERROR'))).toBeNull();
    expect(selectionSaveErrorToast(problemApiError(404, 'NOT_FOUND'))).toBeNull();
  });

  it.each(['BAND_NOT_STORED', 'BAND_PRICE_UNKNOWN'])(
    'returns selectionRefused for a VALIDATION_ERROR carrying %s',
    (code) => {
      const error = validationApiError([
        { field: 'selections.0.customPrice', code: 'INVALID_CUSTOM_PRICE' },
        { field: 'selections.3.band', code },
      ]);
      expect(selectionSaveErrorToast(error)).toBe('selectionRefused');
    },
  );

  it('returns generic for a VALIDATION_ERROR with no band refusal', () => {
    expect(
      selectionSaveErrorToast(
        validationApiError([{ field: 'selections.0.customPrice', code: 'INVALID_CUSTOM_PRICE' }]),
      ),
    ).toBe('generic');
    // The 5000 selection limit (a Zod array issue) and a body with no issues at all.
    expect(
      selectionSaveErrorToast(validationApiError([{ field: 'selections', code: 'too_big' }])),
    ).toBe('generic');
    expect(selectionSaveErrorToast(validationApiError([]))).toBe('generic');
  });
});
