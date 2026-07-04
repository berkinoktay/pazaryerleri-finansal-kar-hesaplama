import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type ImportAdvantageTariffResponse = components['schemas']['ImportAdvantageTariffResponse'];

/**
 * POST /v1/organizations/{orgId}/stores/{storeId}/advantage-tariffs/import
 *
 * Uploads a Trendyol Avantajlı Ürün Etiketleri `.xlsx` as `multipart/form-data`.
 *
 * Multipart convention: openapi-fetch JSON-stringifies bodies by default, so we
 * override `bodySerializer` to build a `FormData` — when the serializer returns
 * `FormData`, openapi-fetch omits `Content-Type` and the browser sets it with the
 * correct multipart boundary. The serializer appends the real `File` from the
 * closure; the typed `body.file` (a string per the generated schema) is only there
 * to satisfy the request-body type and is never read.
 *
 * `commissionSourceTariffId` (optional) pins which Commission Tariff/week supplies the
 * tier rates; omit it to read the category commission instead.
 */
export async function importAdvantageTariff(
  orgId: string,
  storeId: string,
  file: File,
  name?: string,
  commissionSourceTariffId?: string,
): Promise<ImportAdvantageTariffResponse> {
  const hasName = name !== undefined && name !== '';
  const hasSource = commissionSourceTariffId !== undefined && commissionSourceTariffId !== '';
  const { data, error, response } = await apiClient.POST(
    '/v1/organizations/{orgId}/stores/{storeId}/advantage-tariffs/import',
    {
      params: { path: { orgId, storeId } },
      body: {
        file: file.name,
        ...(hasName ? { name } : {}),
        ...(hasSource ? { commissionSourceTariffId } : {}),
      },
      bodySerializer: () => {
        const formData = new FormData();
        formData.append('file', file);
        if (hasName) formData.append('name', name);
        if (hasSource) formData.append('commissionSourceTariffId', commissionSourceTariffId);
        return formData;
      },
    },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
