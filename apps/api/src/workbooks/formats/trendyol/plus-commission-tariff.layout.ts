// The Trendyol Plus commission tariff sheet as layout data. Every column is found by
// header; every period header (either casing of its first word) opens a block of a
// date-range label and the offer column right after it, plus the period's computed
// commission column, looked up by its day count. The Plus import and export both read
// through this file.

import {
  block,
  defineLayout,
  has,
  header,
  type ColumnKey,
  type RowPredicate,
} from '@pazarsync/spreadsheet';

export const trendyolPlusCommissionTariffLayout = defineLayout({
  headerLookahead: 0,
  required: {
    barcode: header('Barkod'),
    currentPrice: header('Güncel TSF'),
    currentCommission: header('Güncel Komisyon'),
    plusPriceUpperLimit: header('Plus Fiyat Üst Limiti'),
  },
  optional: {
    productTitle: header('Ürün İsmi'),
    sellerStockCode: header('Satıcı Stok Kodu'),
    size: header('Beden'),
    modelCode: header('Model Kodu'),
    category: header('Kategori'),
    brand: header('Marka'),
    stock: header('Stok'),
    commissionBasePrice: header('Komisyona Esas Fiyat'),
    plusCommissionBasePrice: header('Plus Komisyona Esas Fiyatı'),
    externalId: header('External Id'),
    tariffGroup: header('Tarife Grubu'),
    cancelled: header('İptal'),
    plusPriceSelection: header('Plus Fiyat Seçimi'),
    tariffSelection: header('Tarife Seçimi'),
  },
  blocks: {
    periods: block({
      anchor: /^Tarih Aral[ıi]ğı \((\d+) Gün\)$/i,
      follow: ['Plus Komisyon Teklifi'],
      columns: {
        label: { offset: 0 },
        offer: { offset: 1 },
      },
      lookups: {
        computedCommission: { template: 'Hesaplanan Komisyon ({tag} Gün)' },
      },
      min: 1,
    }),
  },
});

/** The import keep rule: a row with a barcode. */
export const trendyolPlusCommissionTariffKeep: RowPredicate<
  ColumnKey<typeof trendyolPlusCommissionTariffLayout>
> = has('barcode', 'text');
