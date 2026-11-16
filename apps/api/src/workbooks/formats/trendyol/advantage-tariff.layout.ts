// The Trendyol advantage (star-labelled product) tariff sheet as layout data. Every
// column is found by header. The advantage import and export both read through this
// file.

import {
  all,
  defineLayout,
  has,
  header,
  type ColumnKey,
  type RowPredicate,
} from '@pazarsync/spreadsheet';

export const trendyolAdvantageTariffLayout = defineLayout({
  headerLookahead: 0,
  required: {
    barcode: header('BARKOD'),
    currentPrice: header('TRENDYOL SATIŞ FİYATI'),
    tier1Upper: header('1 YILDIZ ÜST FİYAT'),
    tier1Lower: header('1 YILDIZ ALT FİYAT'),
    tier2Upper: header('2 YILDIZ ÜST FİYAT'),
    tier2Lower: header('2 YILDIZ ALT FİYAT'),
    tier3Upper: header('3 YILDIZ ÜST FİYAT'),
  },
  optional: {
    productTitle: header('ÜRÜN İSMİ'),
    size: header('BEDEN'),
    modelCode: header('MODEL KODU'),
    category: header('KATEGORİ'),
    brand: header('MARKA'),
    stock: header('STOK'),
    commissionTariffFlag: header('KOMİSYON TARİFESİ'),
    customerPrice: header('MÜŞTERİNİN GÖRDÜĞÜ FİYAT'),
    newTsf: header('YENİ TSF (FİYAT GÜNCELLE)'),
    applyUntilEnd: header('Tarife Sonuna Kadar Uygula'),
    externalId: header('EXTERNAL ID'),
    tariffGroup: header('TARİFE GRUBU'),
  },
  blocks: {},
});

/** The import keep rule: a row with a barcode and a current price. */
export const trendyolAdvantageTariffKeep: RowPredicate<
  ColumnKey<typeof trendyolAdvantageTariffLayout>
> = all(has('barcode', 'text'), has('currentPrice', 'decimal'));
