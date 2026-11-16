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
 * ProblemDetails on error, so a blanket `parseAs` would misparse one of them. With
 * `parseAs: 'stream'` openapi-fetch leaves a successful body unread, so we branch on
 * `response.ok`: on success read the `Blob`; on failure openapi-fetch has already read the
 * body and parsed the JSON problem into `error`, which `throwApiError` takes as it is
 * (`code`, `detail`). The consumed body is never read again: a `clone()` of it throws.
 */
export async function exportFlashProducts(
  orgId: string,
  storeId: string,
  listId: string,
): Promise<TariffExportFile> {
  const { error, response } = await apiClient.POST(
    '/v1/organizations/{orgId}/stores/{storeId}/flash-products/{listId}/export',
    { params: { path: { orgId, storeId, listId } }, parseAs: 'stream' },
  );

  if (response === undefined || !response.ok) {
    throwApiError(error, response);
  }

  const blob = await response.blob();
  return { blob, filename: filenameFromDisposition(response.headers.get('Content-Disposition')) };
}
