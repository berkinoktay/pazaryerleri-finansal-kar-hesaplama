import { Platform } from '@pazarsync/db/enums';

import type { WorkbookPage } from './workbook-pages';

/**
 * The marketplace platforms that have a workbook format on each campaign page. The web
 * reads it to disable the upload button for a store whose platform has no format.
 *
 * A static copy of what `apps/api/src/workbooks/formats/registry.ts` registers: utils
 * cannot import the API, so an API unit test pins the two equal. Keys follow
 * `WORKBOOK_PAGES` order; the `Record` annotation makes a missing page a compile error.
 */
export const WORKBOOK_PAGE_PLATFORMS: Readonly<Record<WorkbookPage, readonly Platform[]>> = {
  COMMISSION_TARIFF: [Platform.TRENDYOL],
  PLUS_COMMISSION_TARIFF: [Platform.TRENDYOL],
  ADVANTAGE_TARIFF: [Platform.TRENDYOL],
  FLASH_PRODUCT_LIST: [Platform.TRENDYOL],
  DISCOUNT_LIST: [Platform.TRENDYOL],
  MARKETPLACE_CAMPAIGN_LIST: [Platform.TRENDYOL],
};

/** Whether `platform` has a workbook format on `page`. */
export function hasWorkbookFormat(page: WorkbookPage, platform: Platform): boolean {
  return WORKBOOK_PAGE_PLATFORMS[page].includes(platform);
}
