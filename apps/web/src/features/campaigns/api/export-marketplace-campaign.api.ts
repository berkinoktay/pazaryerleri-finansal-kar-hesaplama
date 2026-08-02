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
 * Binary-download convention: the endpoint returns a file on success but a JSON ProblemDetails
 * on error (incl. 409 when there is no stored source file), so a blanket `parseAs` would
 * misparse one of them. We use `parseAs: 'stream'` (openapi-fetch does NOT consume or JSON-parse
 * the body), then branch on `response.ok`: on success read the `Blob`; on failure re-read the
 * JSON problem from a clone so `throwApiError` keeps full fidelity (`code`, `detail`).
 */
export async function exportMarketplaceCampaign(
  orgId: string,
  storeId: string,
  campaignId: string,
): Promise<TariffExportFile> {
  const { response } = await apiClient.POST(
    '/v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/{campaignId}/export',
    { params: { path: { orgId, storeId, campaignId } }, parseAs: 'stream' },
  );

  if (response === undefined || !response.ok) {
    const problem: unknown =
      response !== undefined
        ? await response
            .clone()
            .json()
            .catch(() => undefined)
        : undefined;
    throwApiError(problem, response);
  }

  const blob = await response.blob();
  return { blob, filename: filenameFromDisposition(response.headers.get('Content-Disposition')) };
}
