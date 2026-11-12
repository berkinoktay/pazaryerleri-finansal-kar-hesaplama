// The Trendyol commission tariff sheet as layout data. Columns A-N are fixed positions
// (four of them guarded by a sentinel header); every period header opens a block of
// a date-range label and its four commission columns; the tail columns are found by
// header. The legacy resolver (services/commission-tariff-layout.ts) stays in use until
// the vertical moves onto this file; tests/unit/workbooks/trendyol-layouts.test.ts
// keeps the two in lockstep.

import {
  block,
  defineLayout,
  has,
  header,
  position,
  type ColumnKey,
  type RowPredicate,
} from '@pazarsync/spreadsheet';

export const trendyolCommissionTariffLayout = defineLayout({
  headerLookahead: 0,
  required: {
    productTitle: position(0),
    barcode: position(1, 'BARKOD'),
    sellerStockCode: position(2),
    size: position(3),
    modelCode: position(4, 'MODEL KODU'),
    category: position(5),
    brand: position(6),
    stock: position(7),
    band1Lower: position(8, '1.Fiyat Alt Limit'),
    band2Upper: position(9),
    band2Lower: position(10),
    band3Upper: position(11),
    band3Lower: position(12),
    band4Upper: position(13, '4.Fiyat Üst Limiti'),
    currentPrice: header('GÜNCEL TSF'),
    currentCommission: header('GÜNCEL KOMİSYON'),
    newTsf: header('YENİ TSF (FİYAT GÜNCELLE)'),
    tariffSelection: header('Tarife Seçimi'),
  },
  optional: {
    commissionBasePrice: header('KOMİSYONA ESAS FİYAT'),
  },
  blocks: {
    periods: block({
      anchor: /^Tarih aralığı \((\d+) Gün\)$/,
      follow: [],
      columns: {
        label: { offset: 0 },
        comm1: { offset: 1 },
        comm2: { offset: 2 },
        comm3: { offset: 3 },
        comm4: { offset: 4 },
      },
      lookups: {},
      min: 1,
    }),
  },
});

/** The import keep rule: a row with a barcode. */
export const trendyolCommissionTariffKeep: RowPredicate<
  ColumnKey<typeof trendyolCommissionTariffLayout>
> = has('barcode', 'text');
