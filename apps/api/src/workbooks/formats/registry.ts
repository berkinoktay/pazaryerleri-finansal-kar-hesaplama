// Every registered workbook format, summarized: id, platform, page and fingerprint,
// as static data. `diagnoseWorkbook` reads it to name the page a wrong upload belongs
// to, so the answer to a wrong file does not depend on which verticals have moved onto
// the generic pipeline yet. Each format file takes these four fields from its summary,
// so every value has one copy.

import { Platform } from '@pazarsync/db/enums';
import { WORKBOOK_PAGES, type WorkbookPage } from '@pazarsync/utils';

import type { Fingerprint, WorkbookFormatId } from '../format';
import { TRENDYOL_FINGERPRINTS } from './trendyol/labels';

export interface FormatSummary {
  readonly id: WorkbookFormatId;
  readonly platform: Platform;
  readonly page: WorkbookPage;
  readonly fingerprint: Fingerprint;
}

/** The version of every Trendyol format registered today. */
const TRENDYOL_FORMAT_VERSION = 1;

function trendyolSummary(page: WorkbookPage): FormatSummary {
  return {
    id: `${Platform.TRENDYOL}:${page}:v${TRENDYOL_FORMAT_VERSION}`,
    platform: Platform.TRENDYOL,
    page,
    fingerprint: TRENDYOL_FINGERPRINTS[page],
  };
}

/** All six Trendyol formats, keyed by page, in `WORKBOOK_PAGES` order (the diagnosis tie-break). */
export const TRENDYOL_FORMAT_SUMMARIES: Readonly<Record<WorkbookPage, FormatSummary>> = {
  COMMISSION_TARIFF: trendyolSummary(WORKBOOK_PAGES.COMMISSION_TARIFF),
  PLUS_COMMISSION_TARIFF: trendyolSummary(WORKBOOK_PAGES.PLUS_COMMISSION_TARIFF),
  ADVANTAGE_TARIFF: trendyolSummary(WORKBOOK_PAGES.ADVANTAGE_TARIFF),
  FLASH_PRODUCT_LIST: trendyolSummary(WORKBOOK_PAGES.FLASH_PRODUCT_LIST),
  DISCOUNT_LIST: trendyolSummary(WORKBOOK_PAGES.DISCOUNT_LIST),
  MARKETPLACE_CAMPAIGN_LIST: trendyolSummary(WORKBOOK_PAGES.MARKETPLACE_CAMPAIGN_LIST),
};

/** Every registered format summary, in registry order. */
export const FORMAT_SUMMARIES: readonly FormatSummary[] = Object.values(TRENDYOL_FORMAT_SUMMARIES);
