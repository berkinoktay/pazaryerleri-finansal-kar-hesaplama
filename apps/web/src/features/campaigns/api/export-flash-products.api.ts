import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

import { filenameFromDisposition, type TariffExportFile } from './binary-download';

export type { TariffExportFile };

/**
 * POST /v1/organizations/{orgId}/stores/{storeId}/flash-products/{listId}/export
 *
 * Returns the ORIGINAL Trendyol Flaş Ürünler `.xlsx` with each selected row's
 * participation written back into "Güncellenecek Fiyat" (24 Saat / 3 Saat / Senin
 * Belirlediğin Flaş Fiyatı) — a custom row additionally gets its numeric price. Every
 * other cell is byte-for-byte unchanged so the file re-uploads verbatim; a list with no
 * selections streams back unchanged. Single file (no periods). Resolves to the bytes plus
 * the server-chosen filename.
 *
 * Binary-download convention: the endpoint returns a file on success but a JSON
 * ProblemDetails on error, so a blanket `parseAs` would misparse one of them. We use
 * `parseAs: 'stream'` (openapi-fetch does NOT consume or JSON-parse the body), then branch
 * on `response.ok`: on success read the `Blob`; on failure re-read the JSON problem from a
 * clone so `throwApiError` keeps full fidelity (`code`, `detail`).
 */
export async function exportFlashProducts(
  orgId: string,
  storeId: string,
  listId: string,
): Promise<TariffExportFile> {
  const { response } = await apiClient.POST(
    '/v1/organizations/{orgId}/stores/{storeId}/flash-products/{listId}/export',
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
