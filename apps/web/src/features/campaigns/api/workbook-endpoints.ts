import { DiscountType } from '@pazarsync/db/enums';
import type { WorkbookPage } from '@pazarsync/utils';

import { apiClient } from '@/lib/api-client/browser';

import { CAMPAIGN_DISCOUNT_TYPES } from '../lib/marketplace-campaign-config';

/** One workbook upload: the file and every form field the page sends with it. */
export interface WorkbookImportInput {
  readonly file: File;
  /** Sent as form fields; an `undefined` or empty value is left out. */
  readonly fields: Readonly<Record<string, string | undefined>>;
}

/** What an import answers, whatever the page calls the new record's id. */
export interface WorkbookImportResult {
  readonly id: string;
  /** Rows that arrived with a choice already filled in (`prefilledRows` of the response). */
  readonly prefilledRows: number;
  /**
   * Product rows the seller will see with an unknown price, as the page's response counts
   * them. Only the two tariff endpoints (commission and Plus) fill it; every other page
   * leaves it out.
   */
  readonly unknownPriceRows?: number;
  /**
   * Products the seller will see with an unknown commission percent (a blank or unreadable
   * cell), as the page's response counts them. The commission, Plus and Flash endpoints fill
   * it; every other page leaves it out.
   */
  readonly unknownCommissionRows?: number;
}

/** The outcome of one import request, before any error is thrown. */
export interface WorkbookImportCall {
  readonly result: WorkbookImportResult | undefined;
  readonly error: unknown;
  readonly response: Response | undefined;
}

/** The outcome of one export request, before any error is thrown or any byte is read. */
export interface WorkbookExportCall {
  readonly error: unknown;
  readonly response: Response | undefined;
}

/** The two requests of one page, each on the page's own literal path. */
export interface WorkbookEndpoint {
  /**
   * Posts the upload. `serialize` builds the multipart body that goes on the wire; the typed
   * `body` of each call only satisfies the generated request type and is never read.
   */
  importFile(
    orgId: string,
    storeId: string,
    input: WorkbookImportInput,
    serialize: () => FormData,
  ): Promise<WorkbookImportCall>;
  /**
   * Posts the export with `parseAs: 'stream'`: a successful body is left unread for the caller,
   * a failed one is already parsed into `error` by openapi-fetch.
   */
  exportFile(orgId: string, storeId: string, id: string): Promise<WorkbookExportCall>;
}

/** A programming error: the discount and campaign forms always set the discount type. */
const MISSING_DISCOUNT_TYPE = 'importFile: discountType is missing';

/**
 * The discount type of a discount upload, narrowed to the generated request type by a lookup.
 * Throws before any request when the form sent none (or one the page does not offer).
 */
function requireDiscountType(input: WorkbookImportInput): DiscountType {
  const discountType = Object.values(DiscountType).find(
    (type) => type === input.fields.discountType,
  );
  if (discountType === undefined) throw new Error(MISSING_DISCOUNT_TYPE);
  return discountType;
}

/** The same for a campaign upload, whose discount types leave out the coupon. */
function requireCampaignDiscountType(
  input: WorkbookImportInput,
): (typeof CAMPAIGN_DISCOUNT_TYPES)[number] {
  const discountType = CAMPAIGN_DISCOUNT_TYPES.find((type) => type === input.fields.discountType);
  if (discountType === undefined) throw new Error(MISSING_DISCOUNT_TYPE);
  return discountType;
}

/**
 * The per-page requests of the workbook import and export. openapi-fetch path types are
 * literals, so each page keeps its two small calls here; the mapping of the page's id key
 * (`tariffId`, `listId`, `campaignId`) to `result.id` happens inside the call, where `data`
 * still has its literal type. Everything else (the multipart body, the error throw, the
 * download name) has one copy in `workbook.api.ts`.
 */
export const WORKBOOK_ENDPOINTS: Readonly<Record<WorkbookPage, WorkbookEndpoint>> = {
  COMMISSION_TARIFF: {
    async importFile(orgId, storeId, input, serialize) {
      const { data, error, response } = await apiClient.POST(
        '/v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/import',
        {
          params: { path: { orgId, storeId } },
          body: { file: input.file.name },
          bodySerializer: serialize,
        },
      );
      const result =
        data === undefined
          ? undefined
          : {
              id: data.tariffId,
              prefilledRows: data.prefilledRows,
              unknownPriceRows: data.unknownCurrentPriceRows,
              unknownCommissionRows: data.unknownCommissionRows,
            };
      return { result, error, response };
    },
    async exportFile(orgId, storeId, id) {
      const { error, response } = await apiClient.POST(
        '/v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}/export',
        { params: { path: { orgId, storeId, tariffId: id } }, parseAs: 'stream' },
      );
      return { error, response };
    },
  },
  PLUS_COMMISSION_TARIFF: {
    async importFile(orgId, storeId, input, serialize) {
      const { data, error, response } = await apiClient.POST(
        '/v1/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs/import',
        {
          params: { path: { orgId, storeId } },
          body: { file: input.file.name },
          bodySerializer: serialize,
        },
      );
      const result =
        data === undefined
          ? undefined
          : {
              id: data.tariffId,
              prefilledRows: data.prefilledRows,
              unknownPriceRows: data.unknownPriceRows,
              unknownCommissionRows: data.unknownCommissionRows,
            };
      return { result, error, response };
    },
    async exportFile(orgId, storeId, id) {
      const { error, response } = await apiClient.POST(
        '/v1/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs/{tariffId}/export',
        { params: { path: { orgId, storeId, tariffId: id } }, parseAs: 'stream' },
      );
      return { error, response };
    },
  },
  ADVANTAGE_TARIFF: {
    async importFile(orgId, storeId, input, serialize) {
      const { data, error, response } = await apiClient.POST(
        '/v1/organizations/{orgId}/stores/{storeId}/advantage-tariffs/import',
        {
          params: { path: { orgId, storeId } },
          body: { file: input.file.name },
          bodySerializer: serialize,
        },
      );
      const result =
        data === undefined ? undefined : { id: data.tariffId, prefilledRows: data.prefilledRows };
      return { result, error, response };
    },
    async exportFile(orgId, storeId, id) {
      const { error, response } = await apiClient.POST(
        '/v1/organizations/{orgId}/stores/{storeId}/advantage-tariffs/{tariffId}/export',
        { params: { path: { orgId, storeId, tariffId: id } }, parseAs: 'stream' },
      );
      return { error, response };
    },
  },
  FLASH_PRODUCT_LIST: {
    async importFile(orgId, storeId, input, serialize) {
      const { data, error, response } = await apiClient.POST(
        '/v1/organizations/{orgId}/stores/{storeId}/flash-products/import',
        {
          params: { path: { orgId, storeId } },
          body: { file: input.file.name },
          bodySerializer: serialize,
        },
      );
      const result =
        data === undefined
          ? undefined
          : {
              id: data.listId,
              prefilledRows: data.prefilledRows,
              unknownCommissionRows: data.unknownCommissionRows,
            };
      return { result, error, response };
    },
    async exportFile(orgId, storeId, id) {
      const { error, response } = await apiClient.POST(
        '/v1/organizations/{orgId}/stores/{storeId}/flash-products/{listId}/export',
        { params: { path: { orgId, storeId, listId: id } }, parseAs: 'stream' },
      );
      return { error, response };
    },
  },
  DISCOUNT_LIST: {
    async importFile(orgId, storeId, input, serialize) {
      const discountType = requireDiscountType(input);
      const { data, error, response } = await apiClient.POST(
        '/v1/organizations/{orgId}/stores/{storeId}/discount-lists/import',
        {
          params: { path: { orgId, storeId } },
          body: { file: input.file.name, discountType },
          bodySerializer: serialize,
        },
      );
      const result =
        data === undefined ? undefined : { id: data.listId, prefilledRows: data.prefilledRows };
      return { result, error, response };
    },
    async exportFile(orgId, storeId, id) {
      const { error, response } = await apiClient.POST(
        '/v1/organizations/{orgId}/stores/{storeId}/discount-lists/{listId}/export',
        { params: { path: { orgId, storeId, listId: id } }, parseAs: 'stream' },
      );
      return { error, response };
    },
  },
  MARKETPLACE_CAMPAIGN_LIST: {
    async importFile(orgId, storeId, input, serialize) {
      const discountType = requireCampaignDiscountType(input);
      const { data, error, response } = await apiClient.POST(
        '/v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/import',
        {
          params: { path: { orgId, storeId } },
          body: { file: input.file.name, discountType },
          bodySerializer: serialize,
        },
      );
      const result =
        data === undefined ? undefined : { id: data.campaignId, prefilledRows: data.prefilledRows };
      return { result, error, response };
    },
    async exportFile(orgId, storeId, id) {
      const { error, response } = await apiClient.POST(
        '/v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/{campaignId}/export',
        { params: { path: { orgId, storeId, campaignId: id } }, parseAs: 'stream' },
      );
      return { error, response };
    },
  },
};
