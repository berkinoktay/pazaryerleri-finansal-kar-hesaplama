// The Turkish texts of the six Trendyol campaign workbooks, in one file: the sheet each
// page reads, the name a list gets when the seller gives none, the values an export
// writes, the yes-flags an import reads and the headers that recognise each page's file.
// Format files, the format registry and tests import them from here; nothing else in
// `src` spells them. Tests that must stay independent of this file (the default names
// of the registry test) write their expectations with `\u` escapes.

import type { WorkbookPage } from '@pazarsync/utils';

/**
 * The sheet each page reads by name. The marketplace campaign file is read by index 0:
 * its sheet name follows the campaign.
 */
export const TRENDYOL_SHEET_NAMES = {
  COMMISSION_TARIFF: 'KomisyonTarifeleriÜrünleri',
  PLUS_COMMISSION_TARIFF: 'TyPlusÜrünleri',
  ADVANTAGE_TARIFF: 'YıldızlıÜrünEtiketleri',
  FLASH_PRODUCT_LIST: 'TeklifÜrünleri',
  DISCOUNT_LIST: 'Ürünler',
} as const satisfies Readonly<Partial<Record<WorkbookPage, string>>>;

/** The name a list of each page gets when the upload form names none. */
export const TRENDYOL_DEFAULT_NAMES: Readonly<Record<WorkbookPage, string>> = {
  COMMISSION_TARIFF: 'Komisyon Tarifesi',
  PLUS_COMMISSION_TARIFF: 'Plus Komisyon Tarifesi',
  ADVANTAGE_TARIFF: 'Avantajlı Ürün Etiketleri',
  FLASH_PRODUCT_LIST: 'Flaş Ürünler',
  DISCOUNT_LIST: 'İndirim Listesi',
  MARKETPLACE_CAMPAIGN_LIST: 'Kampanya',
};

/** Four or more headers of a page's sheet; at least FINGERPRINT_MIN_HEADERS of them recognise its file. */
export type Fingerprint = readonly [string, string, string, ...string[]];

/** The headers that recognise each page's file on another page's route (diagnoseWorkbook). */
export const TRENDYOL_FINGERPRINTS: Readonly<Record<WorkbookPage, Fingerprint>> = {
  COMMISSION_TARIFF: ['BARKOD', 'GÜNCEL TSF', 'Tarife Seçimi', '1.Fiyat Alt Limit'],
  PLUS_COMMISSION_TARIFF: [
    'Barkod',
    'Güncel TSF',
    'Plus Fiyat Üst Limiti',
    'Plus Komisyon Teklifi',
  ],
  ADVANTAGE_TARIFF: ['BARKOD', 'TRENDYOL SATIŞ FİYATI', '1 YILDIZ ÜST FİYAT', '3 YILDIZ ÜST FİYAT'],
  FLASH_PRODUCT_LIST: ['Barkod', 'Mevcut Fiyat', '24 Saat Fiyat', '3 Saat Fiyat'],
  DISCOUNT_LIST: [
    'Barkod',
    'Güncel Satış Fiyatı',
    // Trendyol's own spelling of the header.
    'Kampayaya Dahil Edilsin Mi?',
    'Trendyol Ürün ID',
  ],
  MARKETPLACE_CAMPAIGN_LIST: [
    'Barkod',
    'Maksimum Girebileceğin Fiyat',
    'Kampanyalı Satış Fiyatı',
    'ListingId',
  ],
};

// Values an export writes into a cell.

/** Discount list `included` column: the product joins the campaign. */
export const YES_LABEL = 'Evet';
/** Discount list `included` column, and the Plus `cancelled` column. */
export const NO_LABEL = 'Hayır';
/** Flash `updatedPrice` column: the 24-hour offer. */
export const FLASH_OFFER_24H_LABEL = '24 Saat';
/** Flash `updatedPrice` column: the 3-hour offer. */
export const FLASH_OFFER_3H_LABEL = '3 Saat';
/** Flash `updatedPrice` column: the seller's own flash price, written in `customFlashPrice`. */
export const FLASH_CUSTOM_PRICE_LABEL = 'Senin Belirlediğin Flaş Fiyatı';
/** The unit of a tariff selection: `<days> Günlük Fiyat`, and of a window file's label. */
export const TARIFF_WINDOW_LABEL_UNIT = 'Günlük Fiyat';
/** A tariff selection the commission and Plus exports may write: a day count and the unit. */
export const TARIFF_SELECTION_PATTERN = /^\d+ Günlük Fiyat$/;

/** The tariff selection of a window of `days` days, such as `7 Günlük Fiyat`. */
export function tariffSelectionLabel(days: number): string {
  return `${days} ${TARIFF_WINDOW_LABEL_UNIT}`;
}

// Yes-flags an import reads.

/** Marketplace campaign commission tariff flag, compared exactly. */
export const CAMPAIGN_TARIFF_FLAG_YES = 'Var';
/** Flash and advantage commission tariff flag, in its Turkish lower-case form (compared after `toLocaleLowerCase('tr')`). */
export const TARIFF_FLAG_YES_FOLDED = 'var';
/** Advantage `applyUntilEnd` flag, in its Turkish lower-case form (compared after `toLocaleLowerCase('tr')`). */
export const APPLY_UNTIL_END_YES_FOLDED = 'evet';
