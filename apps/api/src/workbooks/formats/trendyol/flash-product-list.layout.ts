// The Trendyol flash product sheet as layout data. Every column is found by header; a
// row carries its own 24-hour and 3-hour offers, each with a price and a window. The
// flash import and export both read through this file.

import {
  all,
  any,
  defineLayout,
  has,
  header,
  type ColumnKey,
  type RowPredicate,
} from '@pazarsync/spreadsheet';

export const trendyolFlashProductListLayout = defineLayout({
  headerLookahead: 0,
  required: {
    barcode: header('Barkod'),
    currentPrice: header('Mevcut Fiyat'),
    customerPrice: header('Müşterinin Gördüğü Fiyat'),
    currentCommission: header('Mevcut Komisyon'),
    offer24Price: header('24 Saat Fiyat'),
    offer3Price: header('3 Saat Fiyat'),
  },
  optional: {
    modelCode: header('Model Kodu'),
    productTitle: header('Ürün Adı'),
    category: header('Kategori'),
    brand: header('Marka'),
    stock: header('Stok'),
    updatedPrice: header('Güncellenecek Fiyat'),
    customFlashPrice: header('Senin Belirlediğin Flaş Fiyatı'),
    offer24Start: header('24 Saat Flaş Başlangıç Tarihi'),
    offer24End: header('24 Saat Flaş Bitiş Tarihi'),
    offer3Start: header('3 Saat Flaş Başlangıç Tarihi'),
    offer3End: header('3 Saat Flaş Bitiş Tarihi'),
    commissionTariffFlag: header('Ürün Komisyon Tarife Seçeneği'),
    campaignedProduct: header('Kampanyalı Ürün'),
    externalId: header('Ürün Id'),
  },
  blocks: {},
});

/** The import keep rule: a row with a barcode, a current price and at least one offer price. */
export const trendyolFlashProductListKeep: RowPredicate<
  ColumnKey<typeof trendyolFlashProductListLayout>
> = all(
  has('barcode', 'text'),
  has('currentPrice', 'decimal'),
  any(has('offer24Price', 'decimal'), has('offer3Price', 'decimal')),
);
