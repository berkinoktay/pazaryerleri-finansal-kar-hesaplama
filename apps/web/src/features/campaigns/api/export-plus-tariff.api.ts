import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

import { filenameFromDisposition, type TariffExportFile } from './binary-download';

export type { TariffExportFile };

/**
 * POST /v1/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs/{tariffId}/export
 *
 * Returns the ORIGINAL Trendyol Plus `.xlsx` with the seller's opt-in choices patched
 * in, ready to re-upload verbatim — OR a `.zip` of window files when a split week
 * prices a product differently across its sub-periods. Resolves to the bytes plus the
 * server-chosen filename (so the caller downloads it with the right `.xlsx` / `.zip`
 * extension).
 *
 * Binary-download convention: the endpoint returns a file on success but a JSON
 * ProblemDetails on error, so a blanket `parseAs` would misparse one of them. With
 * `parseAs: 'stream'` openapi-fetch leaves a successful body unread, so we branch on
 * `response.ok`: on success read the `Blob`; on failure openapi-fetch has already read the
 * body and parsed the JSON problem into `error`, which `throwApiError` takes as it is
 * (`code`, `detail`). The consumed body is never read again: a `clone()` of it throws.
 */
export async function exportPlusTariff(
  orgId: string,
  storeId: string,
  tariffId: string,
): Promise<TariffExportFile> {
  const { error, response } = await apiClient.POST(
    '/v1/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs/{tariffId}/export',
    { params: { path: { orgId, storeId, tariffId } }, parseAs: 'stream' },
  );

  if (response === undefined || !response.ok) {
    throwApiError(error, response);
  }

  const blob = await response.blob();
  return { blob, filename: filenameFromDisposition(response.headers.get('Content-Disposition')) };
}
