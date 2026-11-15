// Trendyol's marketplace campaign participation workbook (Kampanyalar > Urun Ekle) as a
// format: the first sheet (its name follows the campaign), one row per product, and
// one write-back column, the campaign price the seller chose. The campaign
// configuration is not in the file; it comes with the upload form. MAX writes a row's
// maximum price into that column, so a maximum price the export could not write is
// refused at upload.

import { Decimal } from 'decimal.js';

import { requireStorableInt } from '../../column-range';
import { defineFormat, type WriteValueSpec } from '../../format';
import { WorkbookInvariantError } from '../../workbook-errors';
import { requireWritableValue } from '../../write-columns';
import { TRENDYOL_FORMAT_SUMMARIES } from '../registry';
import { CAMPAIGN_TARIFF_FLAG_YES, TRENDYOL_DEFAULT_NAMES } from './labels';
import {
  trendyolMarketplaceCampaignListKeep,
  trendyolMarketplaceCampaignListLayout,
} from './marketplace-campaign-list.layout';

/** One kept product row of the campaign file. Prices are decimal strings with two places. */
export interface MarketplaceCampaignListRow {
  readonly barcode: string;
  readonly productTitle: string;
  readonly productCode: string | null;
  readonly category: string | null;
  readonly brand: string | null;
  readonly color: string | null;
  readonly size: string | null;
  readonly stockCode: string | null;
  readonly stock: number | null;
  readonly currentPrice: string;
  readonly maxPrice: string;
  readonly hasCommissionTariff: boolean;
  readonly externalId: string | null;
}

/** The campaign file's one write-back column: the price the product joins the campaign at. */
export type MarketplaceCampaignListWriteKey = 'campaignPrice';

/** Lira cells carry cents: a price is read, stored and written with two decimal places. */
export const CAMPAIGN_PRICE_SCALE = 2;

const SUMMARY = TRENDYOL_FORMAT_SUMMARIES.MARKETPLACE_CAMPAIGN_LIST;

/** The campaign price column's write rule; the maximum price is read against it too. */
const CAMPAIGN_PRICE_WRITE: WriteValueSpec = { kind: 'number', scale: CAMPAIGN_PRICE_SCALE };

/** A price the keep rule requires, at two decimal places; a kept row without one is our bug. */
function requiredPrice(value: string | null, what: string): string {
  if (value === null) {
    throw new WorkbookInvariantError(`A kept marketplace campaign row has no ${what}`);
  }
  return new Decimal(value).toFixed(CAMPAIGN_PRICE_SCALE);
}

export const trendyolMarketplaceCampaignListFormat = defineFormat({
  id: SUMMARY.id,
  platform: SUMMARY.platform,
  page: SUMMARY.page,
  // The sheet name follows the campaign, so the file is read by position.
  sheet: { by: 'index', index: 0 },
  layout: trendyolMarketplaceCampaignListLayout,
  keep: trendyolMarketplaceCampaignListKeep,
  anchor: 'barcode',
  fingerprint: SUMMARY.fingerprint,
  mapRow: (reader, anchor): MarketplaceCampaignListRow => ({
    barcode: anchor,
    // A row keeps a readable title even when its barcode matches no product.
    productTitle: reader.text('productTitle') ?? anchor,
    productCode: reader.text('productCode'),
    category: reader.text('category'),
    brand: reader.text('brand'),
    color: reader.text('color'),
    size: reader.text('size'),
    stockCode: reader.text('stockCode'),
    stock: requireStorableInt(reader.int('stock', 'strict')),
    currentPrice: requiredPrice(reader.decimal('currentPrice'), 'current price'),
    maxPrice: requireWritableValue(
      CAMPAIGN_PRICE_WRITE,
      requiredPrice(reader.decimal('maxPrice'), 'maximum price'),
    ),
    hasCommissionTariff: reader.flag('commissionTariffFlag', {
      yes: CAMPAIGN_TARIFF_FLAG_YES,
      compare: 'exact',
    }),
    externalId: reader.text('externalId'),
  }),
  writeBack: {
    campaignPrice: {
      target: { kind: 'column', key: 'campaignPrice' },
      value: CAMPAIGN_PRICE_WRITE,
      overwritesFormula: true,
      seededFromSource: false,
      clearWhenUnselected: false,
    },
  },
  exportRequires: [['campaignPrice']],
  prefilled: 'ignore',
  defaultName: TRENDYOL_DEFAULT_NAMES.MARKETPLACE_CAMPAIGN_LIST,
  filename: { kind: 'source', fallback: { kind: 'fixed', base: 'kampanya' } },
});
