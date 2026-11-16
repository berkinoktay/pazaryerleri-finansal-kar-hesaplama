import type { MessageKeys, Messages, NestedKeyOf } from 'next-intl';

import type { WorkbookPage } from '@pazarsync/utils';

import type { WorkbookErrorBucket } from './workbook-error-bucket';

/**
 * Any full message key path of the app, the same constraint next-intl puts on `t()` of the
 * root translator. A path that does not exist is a compile error (TS2820), so a message key
 * removed while a page still names it here fails typecheck.
 */
export type AppMessageKey = MessageKeys<Messages, NestedKeyOf<Messages>>;

/** What the shared workbook upload code needs to know about one campaign page. */
export interface WorkbookVertical {
  /**
   * The page's own sentence for a bucket, where the shared `campaignUpload.errors` sentence
   * would say less (the page's file by name, its own empty or duplicate-week wording).
   */
  readonly errorOverrides: Readonly<Partial<Record<WorkbookErrorBucket, AppMessageKey>>>;
}

/** One entry per page that accepts a marketplace workbook. */
export const WORKBOOK_VERTICALS: Readonly<Record<WorkbookPage, WorkbookVertical>> = {
  COMMISSION_TARIFF: {
    errorOverrides: {
      wrongFormat: 'commissionTariffsPage.upload.errors.wrongFormat',
      duplicateWeek: 'commissionTariffsPage.upload.errors.duplicateWeek',
    },
  },
  PLUS_COMMISSION_TARIFF: {
    errorOverrides: {
      wrongFormat: 'plusCommissionTariffsPage.upload.errors.wrongFormat',
      duplicateWeek: 'plusCommissionTariffsPage.upload.errors.duplicateWeek',
    },
  },
  ADVANTAGE_TARIFF: {
    errorOverrides: {
      wrongFormat: 'productLabelsPage.upload.errors.wrongFormat',
    },
  },
  FLASH_PRODUCT_LIST: {
    errorOverrides: {
      wrongFormat: 'flashProductsPage.upload.errors.wrongFormat',
      // A flash file lists offers, not products: the page names its own rows.
      empty: 'flashProductsPage.upload.errors.empty',
    },
  },
  DISCOUNT_LIST: {
    errorOverrides: {
      wrongFormat: 'discountsPage.upload.errors.wrongFormat',
    },
  },
  MARKETPLACE_CAMPAIGN_LIST: {
    errorOverrides: {
      wrongFormat: 'marketplaceCampaignsPage.upload.errors.wrongFormat',
    },
  },
};
