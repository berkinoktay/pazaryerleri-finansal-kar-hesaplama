import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type ImportFlashProductsResponse = components['schemas']['ImportFlashProductsResponse'];

/**
 * POST /v1/organizations/{orgId}/stores/{storeId}/flash-products/import
 *
 * Uploads a Trendyol Flaş Ürünler `.xlsx` as `multipart/form-data`. Unlike the Advantage
 * upload there is NO commission-source picker — the reduced commission is AUTO-resolved
 * per row from the store's commission-tariff data at compute time.
 *
 * Multipart convention: openapi-fetch JSON-stringifies bodies by default, so we override
 * `bodySerializer` to build a `FormData` — when the serializer returns `FormData`,
 * openapi-fetch omits `Content-Type` and the browser sets it with the correct multipart
 * boundary. The serializer appends the real `File` from the closure; the typed `body.file`
 * (a string per the generated schema) is only there to satisfy the request-body type and
 * is never read.
 */
export async function importFlashProducts(
  orgId: string,
  storeId: string,
  file: File,
  name?: string,
): Promise<ImportFlashProductsResponse> {
  const hasName = name !== undefined && name !== '';
  const { data, error, response } = await apiClient.POST(
    '/v1/organizations/{orgId}/stores/{storeId}/flash-products/import',
    {
      params: { path: { orgId, storeId } },
      body: {
        file: file.name,
        ...(hasName ? { name } : {}),
      },
      bodySerializer: () => {
        const formData = new FormData();
        formData.append('file', file);
        if (hasName) formData.append('name', name);
        return formData;
      },
    },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
