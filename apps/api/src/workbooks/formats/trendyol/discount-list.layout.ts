// The Trendyol discount product-selection sheet as layout data. Every column is found
// by header. The participation header carries the vendor's own typo; the typo is named
// first, so it wins whenever it appears, even to the right of the corrected spelling
// (names are tried in order). The current price is text like "250 TL", so it reads
// with the currency grammar. The discount import reads through this file; the legacy
// resolver (services/discount-list-layout.ts) serves only the export until it moves
// onto the generic export too.

import {
  all,
  defineLayout,
  has,
  header,
  headerWith,
  type ColumnKey,
  type RowPredicate,
} from '@pazarsync/spreadsheet';

export const trendyolDiscountListLayout = defineLayout({
  headerLookahead: 0,
  required: {
    barcode: header('Barkod'),
    currentPrice: headerWith(['Güncel Satış Fiyatı'], { decimal: 'currency' }),
    included: header('Kampayaya Dahil Edilsin Mi?', 'Kampanyaya Dahil Edilsin Mi?'),
  },
  optional: {
    externalId: header('Trendyol Ürün ID'),
    productTitle: header('Ürün Bilgisi'),
    brand: header('Marka'),
    color: header('Renk'),
    modelCode: header('Model Kodu'),
  },
  blocks: {},
});

/** The import keep rule: a row with a barcode and a current price (currency grammar). */
export const trendyolDiscountListKeep: RowPredicate<ColumnKey<typeof trendyolDiscountListLayout>> =
  all(has('barcode', 'text'), has('currentPrice', 'decimal'));
