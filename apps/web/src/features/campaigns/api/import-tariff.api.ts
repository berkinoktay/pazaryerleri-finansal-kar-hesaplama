import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type ImportTariffResponse = components['schemas']['ImportTariffResponse'];

/**
 * POST /v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/import
 *
 * Uploads a Trendyol commission-tariff `.xlsx` as `multipart/form-data`.
 *
 * Multipart convention (first in this codebase): openapi-fetch JSON-stringifies
 * bodies by default, so we override `bodySerializer` to build a `FormData` — when
 * the serializer returns `FormData`, openapi-fetch omits `Content-Type` and the
 * browser sets it with the correct multipart boundary. The serializer appends the
 * real `File` from the closure; the typed `body.file` (a string per the generated
 * schema) is only there to satisfy the request-body type and is never read.
 */
export async function importTariff(
  orgId: string,
  storeId: string,
  file: File,
  name?: string,
): Promise<ImportTariffResponse> {
  const { data, error, response } = await apiClient.POST(
    '/v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/import',
    {
      params: { path: { orgId, storeId } },
      body: { file: file.name, ...(name !== undefined && name !== '' ? { name } : {}) },
      bodySerializer: () => {
        const formData = new FormData();
        formData.append('file', file);
        if (name !== undefined && name !== '') formData.append('name', name);
        return formData;
      },
    },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
