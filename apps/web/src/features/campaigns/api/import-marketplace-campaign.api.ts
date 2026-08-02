import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

import type {
  CampaignDiscountType,
  CampaignValueKind,
} from './get-marketplace-campaign-detail.api';

export type ImportMarketplaceCampaignResponse =
  components['schemas']['ImportMarketplaceCampaignResponse'];

/**
 * The campaign kurgu + its per-type parameters, Trendyol's funding rate and the campaign
 * window — everything the import form collects alongside the file. Kept local to this API
 * layer (mirrors `ImportDiscountListInput` before the discount vertical grew a dedicated
 * `lib/discount-config.ts`); a future config-editing task may promote this to a shared
 * validated form-values type once the campaign config UI lands.
 */
export interface ImportMarketplaceCampaignConfig {
  discountType: CampaignDiscountType;
  valueKind?: Exclude<CampaignValueKind, null>;
  value?: string;
  minBasketAmount?: string;
  minQuantity?: string;
  buyQuantity?: string;
  payQuantity?: string;
  nthIndex?: string;
  /** Trendyol karşılama oranı (%), 0–100. Omitted → backend defaults to "0". */
  trendyolFundingPct?: string;
  /** ISO date-time. */
  startsAt?: string;
  /** ISO date-time. */
  endsAt?: string;
}

export interface ImportMarketplaceCampaignInput {
  file: File;
  name?: string;
  config: ImportMarketplaceCampaignConfig;
}

/**
 * POST /v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/import
 *
 * Uploads a Trendyol Kampanyalar participation `.xlsx` as `multipart/form-data` together with
 * the campaign configuration. The campaign kurgu (NET / min sepet / N adet / X al Y öde /
 * X. ürüne), its parameters, Trendyol's funding rate and the campaign window are not in the
 * file — they ride in on the form and are persisted onto the campaign row.
 *
 * Multipart convention: openapi-fetch JSON-stringifies bodies by default, so we override
 * `bodySerializer` to build a `FormData` — when the serializer returns `FormData`,
 * openapi-fetch omits `Content-Type` and the browser sets it with the correct multipart
 * boundary. The serializer appends the real `File` plus every non-empty config field from the
 * closure; the typed `body` (strings per the generated schema) is only there to satisfy the
 * request-body type and is never read off the wire.
 */
export async function importMarketplaceCampaign(
  orgId: string,
  storeId: string,
  input: ImportMarketplaceCampaignInput,
): Promise<ImportMarketplaceCampaignResponse> {
  const { data, error, response } = await apiClient.POST(
    '/v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/import',
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
