import type { MessageKeys, Messages, NestedKeyOf } from 'next-intl';

import type { WorkbookPage } from '@pazarsync/utils';

import {
  advantageTariffKeys,
  commissionTariffKeys,
  discountListKeys,
  flashProductKeys,
  marketplaceCampaignKeys,
  plusCommissionTariffKeys,
} from '../query-keys';
import type { WorkbookErrorBucket } from './workbook-error-bucket';

/**
 * Any full message key path of the app, the same constraint next-intl puts on `t()` of the
 * root translator. A path that does not exist is a compile error (TS2820), so a message key
 * removed while a page still names it here fails typecheck.
 */
export type AppMessageKey = MessageKeys<Messages, NestedKeyOf<Messages>>;

/** The query keys an import or export of the page invalidates. */
export interface WorkbookQueryKeys {
  lists(orgId: string, storeId: string): readonly unknown[];
  detail(orgId: string, storeId: string, id: string): readonly unknown[];
}

/** The fields the page's upload form asks for besides the file. */
export type WorkbookUploadExtras =
  | 'none'
  | 'commissionSource'
  | 'discountConfig'
  | 'campaignConfig';

/** How the page's upload dialog lays out its body: one column, or two from `md` up. */
export type WorkbookUploadLayout = 'stack' | 'split';

/** What the shared workbook upload code needs to know about one campaign page. */
export interface WorkbookVertical {
  /**
   * The page's own sentence for a bucket, where the shared `campaignUpload.errors` sentence
   * would say less (the page's file by name, its own empty or duplicate-week wording).
   */
  readonly errorOverrides: Readonly<Partial<Record<WorkbookErrorBucket, AppMessageKey>>>;
  /** The route of the page's detail screen; a record's id is appended to it. */
  readonly detailBase: string;
  readonly keys: WorkbookQueryKeys;
  readonly extras: WorkbookUploadExtras;
  readonly layout: WorkbookUploadLayout;
  /** The class of the upload dialog's content, where the page styles it. */
  readonly modalClassName: string | undefined;
}

/** One entry per page that accepts a marketplace workbook. */
export const WORKBOOK_VERTICALS: Readonly<Record<WorkbookPage, WorkbookVertical>> = {
  COMMISSION_TARIFF: {
    errorOverrides: {
      wrongFormat: 'commissionTariffsPage.upload.errors.wrongFormat',
      duplicateWeek: 'commissionTariffsPage.upload.errors.duplicateWeek',
    },
    detailBase: '/campaigns/product-commission-tariffs',
    keys: commissionTariffKeys,
    extras: 'none',
    layout: 'stack',
    modalClassName: undefined,
  },
  PLUS_COMMISSION_TARIFF: {
    errorOverrides: {
      wrongFormat: 'plusCommissionTariffsPage.upload.errors.wrongFormat',
      duplicateWeek: 'plusCommissionTariffsPage.upload.errors.duplicateWeek',
    },
    detailBase: '/campaigns/plus-commission-tariffs',
    keys: plusCommissionTariffKeys,
    extras: 'none',
    layout: 'stack',
    modalClassName: undefined,
  },
  ADVANTAGE_TARIFF: {
    errorOverrides: {
      wrongFormat: 'productLabelsPage.upload.errors.wrongFormat',
    },
    detailBase: '/campaigns/product-labels',
    keys: advantageTariffKeys,
    extras: 'commissionSource',
    layout: 'split',
    modalClassName: 'advantage-upload-modal',
  },
  FLASH_PRODUCT_LIST: {
    errorOverrides: {
      wrongFormat: 'flashProductsPage.upload.errors.wrongFormat',
      // A flash file lists offers, not products: the page names its own rows.
      empty: 'flashProductsPage.upload.errors.empty',
    },
    detailBase: '/campaigns/flash-products',
    keys: flashProductKeys,
    extras: 'none',
    layout: 'stack',
    modalClassName: undefined,
  },
  DISCOUNT_LIST: {
    errorOverrides: {
      wrongFormat: 'discountsPage.upload.errors.wrongFormat',
    },
    detailBase: '/campaigns/discounts',
    keys: discountListKeys,
    extras: 'discountConfig',
    layout: 'stack',
    modalClassName: 'discount-upload-modal',
  },
  MARKETPLACE_CAMPAIGN_LIST: {
    errorOverrides: {
      wrongFormat: 'marketplaceCampaignsPage.upload.errors.wrongFormat',
    },
    detailBase: '/campaigns/marketplace-campaigns',
    keys: marketplaceCampaignKeys,
    extras: 'campaignConfig',
    layout: 'stack',
    modalClassName: 'marketplace-campaign-upload-modal',
  },
};
