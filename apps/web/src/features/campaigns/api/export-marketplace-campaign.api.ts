import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

import { filenameFromDisposition, type TariffExportFile } from './binary-download';

export type { TariffExportFile };

/**
 * POST /v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/{campaignId}/export
 *
 * Returns Trendyol's ORIGINAL uploaded file with each row's chosen price written into the
 * "Kampanyalı Satış Fiyatı" column: MAX writes the maximum allowed price, CUSTOM writes the
 * seller's own price, NONE leaves the cell untouched (it was already empty in the source).
 * Only cells with a resolved price are patched — every other cell is byte-for-byte unchanged
 * so the file re-uploads to Trendyol verbatim. Marks the campaign exported. Resolves to the
 * bytes plus the server-chosen filename.
 *
 * Binary-download convention: the endpoint returns a file on success but a JSON
 * ProblemDetails on error, so a blanket `parseAs` would misparse one of them. With
 * `parseAs: 'stream'` openapi-fetch leaves a successful body unread, so we branch on
 * `response.ok`: on success read the `Blob`; on failure openapi-fetch has already read the
 * body and parsed the JSON problem into `error`, which `throwApiError` takes as it is
 * (`code`, `detail`). The consumed body is never read again: a `clone()` of it throws.
 */
export async function exportMarketplaceCampaign(
  orgId: string,
  storeId: string,
  campaignId: string,
): Promise<TariffExportFile> {
  const { error, response } = await apiClient.POST(
    '/v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/{campaignId}/export',
    { params: { path: { orgId, storeId, campaignId } }, parseAs: 'stream' },
  );

  if (response === undefined || !response.ok) {
    throwApiError(error, response);
  }

  const blob = await response.blob();
  return { blob, filename: filenameFromDisposition(response.headers.get('Content-Disposition')) };
}
