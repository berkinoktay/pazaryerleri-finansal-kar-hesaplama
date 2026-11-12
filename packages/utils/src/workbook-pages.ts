/**
 * Every campaign page that accepts a marketplace workbook, named after the page's
 * parent Prisma model. Identifiers only: HTTP segments, i18n namespaces and detail
 * paths belong to the api and web layers that key off these values.
 *
 * The values are provisional until PR 3 embeds them in stored workbook format ids
 * (e.g. `TRENDYOL:COMMISSION_TARIFF:v1`); from then on a value is never renamed,
 * a new page gets a new value.
 */
export const WORKBOOK_PAGES = {
  COMMISSION_TARIFF: 'COMMISSION_TARIFF',
  PLUS_COMMISSION_TARIFF: 'PLUS_COMMISSION_TARIFF',
  ADVANTAGE_TARIFF: 'ADVANTAGE_TARIFF',
  FLASH_PRODUCT_LIST: 'FLASH_PRODUCT_LIST',
  DISCOUNT_LIST: 'DISCOUNT_LIST',
  MARKETPLACE_CAMPAIGN_LIST: 'MARKETPLACE_CAMPAIGN_LIST',
} as const;

export type WorkbookPage = (typeof WORKBOOK_PAGES)[keyof typeof WORKBOOK_PAGES];
