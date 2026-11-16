'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { WorkbookPage } from '@pazarsync/utils';

import { importWorkbook } from '../api/workbook.api';
import type { WorkbookImportInput, WorkbookImportResult } from '../api/workbook-endpoints';
import { WORKBOOK_VERTICALS } from '../lib/workbook-verticals';

/**
 * Mutation hook for uploading a marketplace workbook to one campaign page. On success
 * invalidates the page's store list so the new upload appears. No custom onError: the global
 * QueryProvider pipeline toasts a 409 or 503, and the upload dialog renders a 422 and the 413
 * inline.
 */
export function useImportWorkbook(
  page: WorkbookPage,
  orgId: string,
  storeId: string,
): UseMutationResult<WorkbookImportResult, Error, WorkbookImportInput> {
  const queryClient = useQueryClient();
  return useMutation<WorkbookImportResult, Error, WorkbookImportInput>({
    mutationFn: (input) => importWorkbook(page, orgId, storeId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: WORKBOOK_VERTICALS[page].keys.lists(orgId, storeId),
      });
    },
  });
}
