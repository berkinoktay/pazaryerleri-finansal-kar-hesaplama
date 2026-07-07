import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

import { filenameFromDisposition, type TariffExportFile } from './binary-download';

export type { TariffExportFile };

/**
 * POST /v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}/export
 *
 * Returns the ORIGINAL Trendyol `.xlsx` with the seller's band choices patched in,
 * ready to re-upload verbatim — OR a `.zip` of two window files when a split week
 * prices a product differently across its 3-Gün / 4-Gün sub-periods. Resolves to the
 * bytes plus the server-chosen filename (so the caller downloads it with the right
 * `.xlsx` / `.zip` extension).
 *
 * Binary-download convention (first in this codebase): the endpoint returns a file
 * on success but a JSON ProblemDetails on error, so a blanket `parseAs` would
 * misparse one of them. We use `parseAs: 'stream'` (openapi-fetch does NOT consume
 * or JSON-parse the body), then branch on `response.ok`: on success read the `Blob`;
 * on failure re-read the JSON problem from a clone so `throwApiError` keeps full
 * fidelity (`code`, `detail`).
 */
export async function exportTariff(
  orgId: string,
  storeId: string,
  tariffId: string,
): Promise<TariffExportFile> {
  const { response } = await apiClient.POST(
    '/v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}/export',
    { params: { path: { orgId, storeId, tariffId } }, parseAs: 'stream' },
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
