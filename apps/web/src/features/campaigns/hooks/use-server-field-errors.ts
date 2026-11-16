'use client';

import * as React from 'react';
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';

import { validationIssues } from '../lib/upload-error';

/**
 * Pushes the field issues of a backend `422 VALIDATION_ERROR` into a react-hook-form form, so
 * each listed field shows its server refusal through its own `FormMessage`. The issue's code is
 * the error message, the same code the client schema uses, so the field's message mapper turns
 * it into the same sentence. Issues on fields outside `fields` (the file, a name held in local
 * state, a field the form has no input for) are left to the caller, so no issue renders twice.
 * Any other error sets nothing. `VALIDATION_ERROR` is silenced by the global toast pipeline,
 * so this is the only feedback a refused config field gets.
 *
 * An effect is required: `setError` writes into the form's own store, outside React state.
 * Pass a stable `fields` list (a module constant): a new array on each render would re-run the
 * effect and apply the last server errors again.
 */
export function useServerFieldErrors<T extends FieldValues>(
  form: UseFormReturn<T>,
  error: Error | null | undefined,
  fields: readonly Path<T>[],
): void {
  React.useEffect(() => {
    for (const issue of validationIssues(error)) {
      const field = fields.find((name) => name === issue.field);
      if (field !== undefined) {
        form.setError(field, { type: 'server', message: issue.code });
      }
    }
  }, [error, form, fields]);
}
