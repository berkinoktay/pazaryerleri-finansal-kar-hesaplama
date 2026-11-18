'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { WorkbookPage } from '@pazarsync/utils';

import { importWorkbook } from '../api/workbook.api';
import type { WorkbookImportInput, WorkbookImportResult } from '../api/workbook-endpoints';
import { hasInvalidCommissionSource } from '../lib/upload-error';
import { WORKBOOK_VERTICALS } from '../lib/workbook-verticals';
import { commissionTariffKeys } from '../query-keys';

/**
 * Mutation hook for uploading a marketplace workbook to one campaign page. On success
 * invalidates the page's store list so the new upload appears. The upload dialog renders a 422,
 * the 413 and the quota 409 (`UPLOAD_QUOTA_EXCEEDED`) inline, and the global QueryProvider
 * pipeline toasts every other 409 and the 503, so the hook toasts nothing itself. Its only
 * onError work: a refused commission source (`INVALID_COMMISSION_SOURCE`, the pinned commission
 * tariff no longer exists) means the cached commission tariff list of the store is stale, so it
 * is invalidated and the picker drops the deleted week once the refetch lands.
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
    onError: (error) => {
      if (!hasInvalidCommissionSource(error)) return;
      void queryClient.invalidateQueries({
        queryKey: commissionTariffKeys.lists(orgId, storeId),
      });
    },
  });
}
