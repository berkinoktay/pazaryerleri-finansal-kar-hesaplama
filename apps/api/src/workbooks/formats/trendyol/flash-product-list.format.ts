// Trendyol's flash product workbook (Flas Urunler, the offer products sheet) as a
// format: the named sheet, one row per product and date, and two write-back columns,
// the participation label and the seller's own flash price. A row carries up to two
// offers, a 24-hour and a 3-hour one, each with its price and its window; the same
// product appears on several rows, one per date. No value read from the file is
// written back: the label is one of three fixed texts and the price is the seller's.

import type { RowReader, WallClockPattern } from '@pazarsync/spreadsheet';

import { defineFormat, type WriteValueSpec } from '../../format';
import { WorkbookInvariantError } from '../../workbook-errors';
import { TRENDYOL_FORMAT_SUMMARIES } from '../registry';
import {
  trendyolFlashProductListKeep,
  trendyolFlashProductListLayout,
} from './flash-product-list.layout';
import {
  FLASH_CUSTOM_PRICE_LABEL,
  FLASH_OFFER_24H_LABEL,
  FLASH_OFFER_3H_LABEL,
  TARIFF_FLAG_YES_FOLDED,
  TRENDYOL_DEFAULT_NAMES,
  TRENDYOL_SHEET_NAMES,
} from './labels';

/** One flash offer of a row: its price as read (a decimal string) and its window, when it reads. */
export interface FlashOffer {
  readonly price: string;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
}

/** One kept row of the flash file: one product on one date, with its offers. */
export interface FlashProductListRow {
  readonly barcode: string;
  readonly modelCode: string | null;
  readonly productTitle: string;
  readonly category: string | null;
  readonly brand: string | null;
  readonly stock: number | null;
  readonly currentPrice: string;
  readonly customerPrice: string;
  readonly currentCommissionPct: string;
  readonly hasCommissionTariff: boolean;
  readonly campaignedProduct: string | null;
  readonly offer24: FlashOffer | null;
  readonly offer3: FlashOffer | null;
  readonly externalId: string | null;
}

/** The flash file's write-back columns: the participation label and the seller's own price. */
export type FlashProductListWriteKey = 'updatedPrice' | 'customFlashPrice';

/** The seller's own flash price is written with two decimal places. */
export const FLASH_PRICE_SCALE = 2;

/** Trendyol stamps an offer window as Istanbul wall-clock text. */
const FLASH_WINDOW_PATTERN: WallClockPattern = 'dd/MM/yyyy HH:mm';

/** The commission percent of a row whose current commission cell is blank. */
const COMMISSION_PCT_WHEN_BLANK = '0';

const SUMMARY = TRENDYOL_FORMAT_SUMMARIES.FLASH_PRODUCT_LIST;

/** The participation label column: one of the three texts Trendyol reads back. */
const UPDATED_PRICE_WRITE: WriteValueSpec = {
  kind: 'text',
  allow: [FLASH_OFFER_24H_LABEL, FLASH_OFFER_3H_LABEL, FLASH_CUSTOM_PRICE_LABEL],
};

/** The custom price column: a lira amount with two decimal places. */
const CUSTOM_FLASH_PRICE_WRITE: WriteValueSpec = { kind: 'number', scale: FLASH_PRICE_SCALE };

type FlashReader = RowReader<typeof trendyolFlashProductListLayout>;

/**
 * One offer of a row: present when its price reads. Its window may still be absent or
 * unreadable; the price is kept either way.
 */
function readOffer(
  reader: FlashReader,
  price: 'offer24Price' | 'offer3Price',
  start: 'offer24Start' | 'offer3Start',
  end: 'offer24End' | 'offer3End',
): FlashOffer | null {
  const offerPrice = reader.decimal(price);
  if (offerPrice === null) return null;
  return {
    price: offerPrice,
    startsAt: reader.instant(start, FLASH_WINDOW_PATTERN),
    endsAt: reader.instant(end, FLASH_WINDOW_PATTERN),
  };
}

export const trendyolFlashProductListFormat = defineFormat({
  id: SUMMARY.id,
  platform: SUMMARY.platform,
  page: SUMMARY.page,
  sheet: { by: 'name', name: TRENDYOL_SHEET_NAMES.FLASH_PRODUCT_LIST },
  layout: trendyolFlashProductListLayout,
  keep: trendyolFlashProductListKeep,
  anchor: 'barcode',
  fingerprint: SUMMARY.fingerprint,
  mapRow: (reader, anchor): FlashProductListRow => {
    // The keep rule requires a current price; a kept row without one is our bug.
    const currentPrice = reader.decimal('currentPrice');
    if (currentPrice === null) {
      throw new WorkbookInvariantError('A kept flash product row has no current price');
    }
    return {
      barcode: anchor,
      modelCode: reader.text('modelCode'),
      // A row keeps a readable title even when its barcode matches no product.
      productTitle: reader.text('productTitle') ?? anchor,
      category: reader.text('category'),
      brand: reader.text('brand'),
      stock: reader.int('stock', 'truncate'),
      currentPrice,
      customerPrice: reader.decimal('customerPrice') ?? currentPrice,
      // The flat fallback commission; the real export always fills it.
      currentCommissionPct: reader.decimal('currentCommission') ?? COMMISSION_PCT_WHEN_BLANK,
      hasCommissionTariff: reader.flag('commissionTariffFlag', {
        yes: TARIFF_FLAG_YES_FOLDED,
        compare: 'casefold-tr',
      }),
      campaignedProduct: reader.text('campaignedProduct'),
      offer24: readOffer(reader, 'offer24Price', 'offer24Start', 'offer24End'),
      offer3: readOffer(reader, 'offer3Price', 'offer3Start', 'offer3End'),
      externalId: reader.text('externalId'),
    };
  },
  writeBack: {
    updatedPrice: {
      target: { kind: 'column', key: 'updatedPrice' },
      value: UPDATED_PRICE_WRITE,
      overwritesFormula: true,
      seededFromSource: false,
      clearWhenUnselected: false,
    },
    customFlashPrice: {
      target: { kind: 'column', key: 'customFlashPrice' },
      value: CUSTOM_FLASH_PRICE_WRITE,
      overwritesFormula: true,
      seededFromSource: false,
      clearWhenUnselected: false,
    },
  },
  // The label column is what Trendyol reads; a file without it cannot be exported.
  exportRequires: [['updatedPrice']],
  prefilled: 'ignore',
  defaultName: TRENDYOL_DEFAULT_NAMES.FLASH_PRODUCT_LIST,
  filename: { kind: 'fixed', base: 'flas-urunler' },
});
