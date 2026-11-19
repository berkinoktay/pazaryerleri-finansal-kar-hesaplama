// Trendyol's discount product-selection workbook (Promosyon > Indirimler) as a format:
// the named product sheet, one row per product, and one write-back column, the
// participation flag. The discount configuration is not in the file; it comes with the
// upload form.

import { defineFormat } from '../../format';
import { WorkbookInvariantError } from '../../workbook-errors';
import { TRENDYOL_FORMAT_SUMMARIES } from '../registry';
import { trendyolDiscountListKeep, trendyolDiscountListLayout } from './discount-list.layout';
import { NO_LABEL, TRENDYOL_DEFAULT_NAMES, TRENDYOL_SHEET_NAMES, YES_LABEL } from './labels';

/** One kept product row of the discount file. */
export interface DiscountListRow {
  readonly barcode: string;
  readonly externalId: string | null;
  readonly productTitle: string;
  readonly brand: string | null;
  readonly color: string | null;
  readonly modelCode: string | null;
  readonly currentPrice: string;
  readonly included: boolean;
}

/** The discount file's one write-back column: does the product join the campaign. */
export type DiscountListWriteKey = 'included';

const SUMMARY = TRENDYOL_FORMAT_SUMMARIES.DISCOUNT_LIST;

export const trendyolDiscountListFormat = defineFormat({
  id: SUMMARY.id,
  platform: SUMMARY.platform,
  page: SUMMARY.page,
  sheet: { by: 'name', name: TRENDYOL_SHEET_NAMES.DISCOUNT_LIST },
  layout: trendyolDiscountListLayout,
  keep: trendyolDiscountListKeep,
  anchor: 'barcode',
  fingerprint: SUMMARY.fingerprint,
  mapRow: (reader, anchor): DiscountListRow => {
    // The keep rule requires a current price; a kept row without one is our bug.
    const currentPrice = reader.decimal('currentPrice');
    if (currentPrice === null) {
      throw new WorkbookInvariantError('A kept discount row has no current price');
    }
    return {
      barcode: anchor,
      externalId: reader.text('externalId'),
      // A row keeps a readable title even when its barcode matches no product.
      productTitle: reader.displayText('productTitle') ?? anchor,
      brand: reader.displayText('brand'),
      color: reader.displayText('color'),
      modelCode: reader.displayText('modelCode'),
      currentPrice,
      included: reader.flag('included', { yes: YES_LABEL, compare: 'exact' }),
    };
  },
  writeBack: {
    included: {
      target: { kind: 'column', key: 'included' },
      value: { kind: 'text', allow: [YES_LABEL, NO_LABEL] },
      overwritesFormula: true,
      seededFromSource: true,
      clearWhenUnselected: false,
    },
  },
  exportRequires: [['included']],
  prefilled: 'ignore',
  defaultName: TRENDYOL_DEFAULT_NAMES.DISCOUNT_LIST,
  filename: { kind: 'source', fallback: { kind: 'fixed', base: 'indirimler' } },
});
