import { renderHook } from '@testing-library/react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { describe, expect, it } from 'vitest';

import { useServerFieldErrors } from '@/features/campaigns/hooks/use-server-field-errors';

import { problemApiError, validationApiError } from '../../../helpers/api-error';

interface TestValues {
  value?: string;
  startsAt?: string;
  name?: string;
}

/** The fields the form walks; `name` is deliberately left out. */
const LISTED_FIELDS = ['value', 'startsAt'] as const;

/** A form whose server errors come from `error`, as a config form wires the hook. */
function renderForm(error: Error | null | undefined): UseFormReturn<TestValues> {
  const { result } = renderHook(() => {
    const form = useForm<TestValues>();
    useServerFieldErrors(form, error, LISTED_FIELDS);
    return form;
  });
  return result.current;
}

describe('useServerFieldErrors', () => {
  it('sets a server error carrying the code on each listed field of a 422 and on no other', () => {
    const form = renderForm(
      validationApiError([
        { field: 'value', code: 'INVALID_DISCOUNT_VALUE' },
        { field: 'startsAt', code: 'DATE_OUT_OF_RANGE' },
        { field: 'name', code: 'NAME_TOO_LONG' },
        { field: 'file', code: 'EMPTY_FILE' },
      ]),
    );

    expect(form.getFieldState('value').error).toEqual(
      expect.objectContaining({ type: 'server', message: 'INVALID_DISCOUNT_VALUE' }),
    );
    expect(form.getFieldState('startsAt').error).toEqual(
      expect.objectContaining({ type: 'server', message: 'DATE_OUT_OF_RANGE' }),
    );
    expect(form.getFieldState('name').error).toBeUndefined();
  });

  it.each([
    ['a 409', problemApiError(409, 'IMPORT_IN_PROGRESS')],
    ['the 413', problemApiError(413, 'PAYLOAD_TOO_LARGE')],
    ['a plain error', new Error('network down')],
    ['no error', null],
  ])('sets no error for %s', (_label, error) => {
    const form = renderForm(error);

    expect(form.getFieldState('value').error).toBeUndefined();
    expect(form.getFieldState('startsAt').error).toBeUndefined();
    expect(form.getFieldState('name').error).toBeUndefined();
  });
});
