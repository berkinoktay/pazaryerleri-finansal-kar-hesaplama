// The Trendyol marketplace campaign participation sheet as layout data. A strict
// template: every column is required and found by header. The current and maximum
// prices read with the currency grammar. The legacy resolver
// (services/marketplace-campaign-layout.ts) stays in use until the vertical moves onto
// this file; tests/unit/workbooks/trendyol-layouts.test.ts keeps the two in lockstep.

import {
  all,
  defineLayout,
  has,
  header,
  headerWith,
  type ColumnKey,
  type RowPredicate,
} from '@pazarsync/spreadsheet';

export const trendyolMarketplaceCampaignListLayout = defineLayout({
  headerLookahead: 0,
  required: {
    barcode: header('Barkod'),
    productTitle: header('Ürün Adı'),
    productCode: header('Ürün Kodu'),
    category: header('Kategori'),
    brand: header('Marka'),
    color: header('Renk'),
    size: header('Beden'),
    stockCode: header('Stok Kodu'),
    stock: header('Mevcut Stok'),
    currentPrice: headerWith(['Mevcut Satış Fiyatı'], { decimal: 'currency' }),
    maxPrice: headerWith(['Maksimum Girebileceğin Fiyat'], { decimal: 'currency' }),
    campaignPrice: header('Kampanyalı Satış Fiyatı'),
    commissionTariffFlag: header('Ürün Komisyon Tarifesi'),
    externalId: header('ListingId'),
  },
  optional: {},
  blocks: {},
});

/** The import keep rule: a row with a barcode, a current price and a maximum price (currency grammar). */
export const trendyolMarketplaceCampaignListKeep: RowPredicate<
  ColumnKey<typeof trendyolMarketplaceCampaignListLayout>
> = all(has('barcode', 'text'), has('currentPrice', 'decimal'), has('maxPrice', 'decimal'));
