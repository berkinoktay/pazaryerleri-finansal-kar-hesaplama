'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { WorkbookPage } from '@pazarsync/utils';

import type { WorkbookExportFile } from '../api/binary-download';
import { exportWorkbook } from '../api/workbook.api';
import { WORKBOOK_VERTICALS } from '../lib/workbook-verticals';

/**
 * Mutation hook for exporting one record of a campaign page as its patched marketplace file.
 * The mutation variable is the record's id; the result carries the file bytes and the
 * server-chosen filename, and the caller triggers the browser download. Export marks the record
 * exported, so onSuccess invalidates both the page's list (its "exported" column) and that
 * record's detail. No custom onError: the global pipeline toasts.
 */
export function useExportWorkbook(
  page: WorkbookPage,
  orgId: string,
  storeId: string,
): UseMutationResult<WorkbookExportFile, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<WorkbookExportFile, Error, string>({
    mutationFn: (id) => exportWorkbook(page, orgId, storeId, id),
    onSuccess: (_file, id) => {
      const { keys } = WORKBOOK_VERTICALS[page];
      void queryClient.invalidateQueries({ queryKey: keys.lists(orgId, storeId) });
      void queryClient.invalidateQueries({ queryKey: keys.detail(orgId, storeId, id) });
    },
  });
}
