import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

import { filenameFromDisposition, type TariffExportFile } from './binary-download';

export type { TariffExportFile };

/**
 * POST /v1/organizations/{orgId}/stores/{storeId}/discount-lists/{listId}/export
 *
 * Returns the ORIGINAL uploaded Trendyol İndirimler `.xlsx` with each row's participation
 * written back into "Kampayaya Dahil Edilsin Mi?" (an included row gets "Evet", an excluded
 * row gets "Hayır"). Only cells that DEVIATE from the source are patched — every other cell is
 * byte-for-byte unchanged so the file re-uploads to Trendyol verbatim; a list with no changes
 * vs. the original streams back byte-for-byte identical. Marks the list exported. Resolves to
 * the bytes plus the server-chosen filename.
 *
 * Binary-download convention: the endpoint returns a file on success but a JSON ProblemDetails
 * on error (incl. 409 when there is no stored source file), so a blanket `parseAs` would
 * misparse one of them. We use `parseAs: 'stream'` (openapi-fetch does NOT consume or JSON-parse
 * the body), then branch on `response.ok`: on success read the `Blob`; on failure re-read the
 * JSON problem from a clone so `throwApiError` keeps full fidelity (`code`, `detail`).
 */
export async function exportDiscountList(
  orgId: string,
  storeId: string,
  listId: string,
): Promise<TariffExportFile> {
  const { response } = await apiClient.POST(
    '/v1/organizations/{orgId}/stores/{storeId}/discount-lists/{listId}/export',
    { params: { path: { orgId, storeId, listId } }, parseAs: 'stream' },
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
