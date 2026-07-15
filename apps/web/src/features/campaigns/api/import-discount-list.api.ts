import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

import type { DiscountConfigFormValues } from '../lib/discount-config';

// `DiscountConfigFormValues` is owned by `../lib/discount-config` (re-homed in Görev 14).
// Re-exported here so existing import sites (e.g. use-import-discount-list) keep working.
export type { DiscountConfigFormValues };

export type ImportDiscountListResponse = components['schemas']['ImportDiscountListResponse'];

export interface ImportDiscountListInput {
  file: File;
  name?: string;
  config: DiscountConfigFormValues;
}

/**
 * POST /v1/organizations/{orgId}/stores/{storeId}/discount-lists/import
 *
 * Uploads a Trendyol İndirimler product-selection `.xlsx` as `multipart/form-data` together
 * with the discount configuration fields. Trendyol reuses the SAME selection sheet for every
 * discount type, so the discount kurgu (NET / min basket / N adet / X al Y öde / X. ürün /
 * indirim kodu) and its parameters ride in on the form and are persisted onto the list row.
 *
 * Multipart convention: openapi-fetch JSON-stringifies bodies by default, so we override
 * `bodySerializer` to build a `FormData` — when the serializer returns `FormData`,
 * openapi-fetch omits `Content-Type` and the browser sets it with the correct multipart
 * boundary. The serializer appends the real `File` plus every non-empty config field from the
 * closure; the typed `body` (strings per the generated schema) is only there to satisfy the
 * request-body type and is never read off the wire.
 */
export async function importDiscountList(
  orgId: string,
  storeId: string,
  input: ImportDiscountListInput,
): Promise<ImportDiscountListResponse> {
  const { data, error, response } = await apiClient.POST(
    '/v1/organizations/{orgId}/stores/{storeId}/discount-lists/import',
    {
      params: { path: { orgId, storeId } },
      body: { file: input.file.name, discountType: input.config.discountType },
      bodySerializer: () => {
        const formData = new FormData();
        formData.append('file', input.file);
        if (input.name !== undefined && input.name !== '') formData.append('name', input.name);
        for (const [key, value] of Object.entries(input.config)) {
          if (value !== undefined && value !== '') formData.append(key, value);
        }
        return formData;
      },
    },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
