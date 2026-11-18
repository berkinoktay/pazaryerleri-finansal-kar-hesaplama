// The derived-row cases of the six Trendyol workbook verticals. The real exports drop
// no row, so each vertical also needs rows built from its fixture's first kept row with
// some cells blanked or rewritten: they put the fallback chains of a row mapper and the
// dropping side of every keep rule under test. The cases were moved verbatim out of
// tests/unit/workbooks/trendyol-layouts.test.ts, since deleted, so they outlive the
// legacy parsers (every block has since gained kept cases, whose golden the legacy
// parser wrote); `derivedGrid` builds the grid a format test reads them from.

import {
  columnIndex,
  evaluate,
  resolveLayout,
  type BlockKey,
  type CellValue,
  type ColumnKey,
  type LayoutSpec,
  type RowPredicate,
  type SheetData,
} from '@pazarsync/spreadsheet';

import type { trendyolAdvantageTariffLayout } from '@/workbooks/formats/trendyol/advantage-tariff.layout';
import type { trendyolCommissionTariffLayout } from '@/workbooks/formats/trendyol/commission-tariff.layout';
import type { trendyolDiscountListLayout } from '@/workbooks/formats/trendyol/discount-list.layout';
import type { trendyolFlashProductListLayout } from '@/workbooks/formats/trendyol/flash-product-list.layout';
import type { trendyolMarketplaceCampaignListLayout } from '@/workbooks/formats/trendyol/marketplace-campaign-list.layout';
import type { trendyolPlusCommissionTariffLayout } from '@/workbooks/formats/trendyol/plus-commission-tariff.layout';
import {
  CAMPAIGN_TARIFF_FLAG_YES,
  NO_LABEL,
  TARIFF_FLAG_YES_FOLDED,
  YES_LABEL,
} from '@/workbooks/formats/trendyol/labels';

/**
 * A cell inside a repeated block that a derived row overwrites: the block, its position
 * among the resolved blocks of that key (0 is the first), and the block column.
 */
export interface DerivedBlockCell<S extends LayoutSpec> {
  readonly block: BlockKey<S>;
  readonly index: number;
  readonly column: string;
  readonly value: CellValue;
}

/** A data row derived from a fixture's first kept row by overwriting some of its cells. */
export interface DerivedRow<S extends LayoutSpec> {
  readonly name: string;
  readonly cells: ReadonlyArray<readonly [ColumnKey<S>, CellValue]>;
  /** Cells inside a repeated block, written after `cells`. */
  readonly blockCells?: readonly DerivedBlockCell<S>[];
  /** Whether the import keeps the row, so a case cannot drift to the other side unnoticed. */
  readonly kept: boolean;
}

const COMMISSION_DERIVED: readonly DerivedRow<typeof trendyolCommissionTariffLayout>[] = [
  { name: 'a blank barcode', cells: [['barcode', null]], kept: false },
  // Added after the move, so the derived golden pins every mapping rule of the commission
  // row: the stock code chain (the model code, else the seller stock code, else null),
  // the title fallback, the truncated stock, a blank or unreadable current price read as
  // null, a blank current commission read as null (never 0), a blank commission base
  // price kept null, a blank or unreadable bracket limit, a blank period commission, the
  // first period block filled, the plain grammar of the decimal cells (decimal comma,
  // dot-only text, a lira suffix that does not read, a number in exponent form), a
  // number barcode, a whitespace barcode, and values the export never writes, which the
  // import does not check. The fixture row's seller stock code and first (3-day) period
  // block are blank; its prices, limits and commissions are number cells. An unreadable
  // current commission (also read as null) is pinned by the format's unit test only, so
  // the digest changed for one reason alone when unknown commissions became null.
  { name: 'a whitespace barcode', cells: [['barcode', '   ']], kept: false },
  { name: 'a number barcode', cells: [['barcode', 8690000000001]], kept: true },
  {
    name: 'a model code beside a seller stock code',
    cells: [['sellerStockCode', 'SELLER-1']],
    kept: true,
  },
  {
    name: 'a blank model code beside a seller stock code',
    cells: [
      ['modelCode', null],
      ['sellerStockCode', 'SELLER-1'],
    ],
    kept: true,
  },
  {
    name: 'a blank model code and seller stock code',
    cells: [
      ['modelCode', null],
      ['sellerStockCode', null],
    ],
    kept: true,
  },
  {
    name: 'a blank title and blank optional columns',
    cells: [
      ['productTitle', null],
      ['size', null],
      ['category', null],
      ['brand', null],
      ['stock', null],
    ],
    kept: true,
  },
  { name: 'a number category', cells: [['category', 42]], kept: true },
  { name: 'a decimal stock number', cells: [['stock', 12.7]], kept: true },
  { name: 'a decimal stock text', cells: [['stock', '12.7']], kept: true },
  { name: 'a non-numeric stock text', cells: [['stock', 'many']], kept: true },
  { name: 'a blank current price', cells: [['currentPrice', null]], kept: true },
  { name: 'a blank commission base price', cells: [['commissionBasePrice', null]], kept: true },
  { name: 'a blank current commission', cells: [['currentCommission', null]], kept: true },
  { name: 'a blank band 2 upper limit', cells: [['band2Upper', null]], kept: true },
  {
    name: 'a blank band 1 lower limit and band 4 upper limit',
    cells: [
      ['band1Lower', null],
      ['band4Upper', null],
    ],
    kept: true,
  },
  { name: 'an unreadable band 3 lower limit', cells: [['band3Lower', 'none']], kept: true },
  {
    name: 'a blank commission in the filled period',
    cells: [],
    blockCells: [{ block: 'periods', index: 1, column: 'comm3', value: null }],
    kept: true,
  },
  {
    name: 'a filled first period block',
    cells: [],
    blockCells: [
      { block: 'periods', index: 0, column: 'label', value: '23 Haziran 08.00-26 Haziran 07.59' },
      { block: 'periods', index: 0, column: 'comm1', value: 19 },
      { block: 'periods', index: 0, column: 'comm2', value: '12,5' },
      { block: 'periods', index: 0, column: 'comm4', value: 9.2 },
    ],
    kept: true,
  },
  {
    name: 'dot thousands with a decimal comma',
    cells: [
      ['currentPrice', '1.234,56'],
      ['commissionBasePrice', '1.199,99'],
      ['currentCommission', '19,5'],
      ['band1Lower', '1.234,57'],
      ['band2Upper', '1.234,56'],
      ['band2Lower', '1.199,99'],
    ],
    blockCells: [{ block: 'periods', index: 1, column: 'comm2', value: '12,5' }],
    kept: true,
  },
  {
    name: 'dot-only text prices',
    cells: [
      ['currentPrice', '1.250'],
      ['band4Upper', '1.100'],
    ],
    kept: true,
  },
  {
    name: 'lira-suffixed prices and commission',
    cells: [
      ['currentPrice', '360 TL'],
      ['commissionBasePrice', '350 TL'],
      ['band3Upper', '292 TL'],
    ],
    blockCells: [{ block: 'periods', index: 1, column: 'comm1', value: '15 TL' }],
    kept: true,
  },
  {
    name: 'a number in exponent form',
    cells: [],
    blockCells: [{ block: 'periods', index: 1, column: 'comm2', value: 1e-7 }],
    kept: true,
  },
  {
    name: 'negative values the export never writes',
    cells: [
      ['commissionBasePrice', '-2'],
      ['currentCommission', -1],
      ['band2Lower', -4],
    ],
    blockCells: [{ block: 'periods', index: 1, column: 'comm4', value: -3 }],
    kept: true,
  },
];

const PLUS_CANCEL_NUMBER_ONE: DerivedRow<typeof trendyolPlusCommissionTariffLayout> = {
  name: 'the number 1 in the cancel cell',
  cells: [['cancelled', 1]],
  kept: true,
};

const PLUS_CANCEL_TEXT_ZERO: DerivedRow<typeof trendyolPlusCommissionTariffLayout> = {
  name: 'the text "0" in the cancel cell',
  cells: [['cancelled', '0']],
  kept: true,
};

// Not in PLUS_DERIVED: the frozen derived golden digest predates the yes-label read, so
// this case is read on its own by the format test.
const PLUS_CANCEL_YES_LABEL: DerivedRow<typeof trendyolPlusCommissionTariffLayout> = {
  name: 'the yes label in the cancel cell',
  cells: [['cancelled', YES_LABEL]],
  kept: true,
};

const PLUS_DERIVED: readonly DerivedRow<typeof trendyolPlusCommissionTariffLayout>[] = [
  { name: 'a blank barcode', cells: [['barcode', null]], kept: false },
  PLUS_CANCEL_NUMBER_ONE,
  PLUS_CANCEL_TEXT_ZERO,
  // Added after the move, so the derived golden pins every mapping rule of the Plus row:
  // the three fallback chains (stock code, commission base price, Plus commission base
  // price) with their first cell blank and with every cell blank, the null of each blank
  // price and of each blank percent (never 0), a blank period offer read as null, a zero
  // period offer kept as '0', the title fallback, the truncated stock, the plain grammar
  // of the decimal cells (decimal comma, dot-only text, a lira suffix that does not read,
  // also on the offer, read as null), the numeric cancel flag, a number barcode, a
  // whitespace barcode, and values the export never writes, which the import does not
  // check. The fixture row's prices, limits and offers are number cells. A literal 0
  // price (also read as null) is pinned by the format's unit test only, so the digest
  // changed for one reason alone when unknown prices became null; likewise the digest
  // changed for one reason alone when unknown percents became null.
  { name: 'a whitespace barcode', cells: [['barcode', '   ']], kept: false },
  { name: 'a blank model code', cells: [['modelCode', null]], kept: true },
  {
    name: 'a blank model code and seller stock code',
    cells: [
      ['modelCode', null],
      ['sellerStockCode', null],
    ],
    kept: true,
  },
  { name: 'a blank commission base price', cells: [['commissionBasePrice', null]], kept: true },
  {
    name: 'a blank commission base price and current price',
    cells: [
      ['commissionBasePrice', null],
      ['currentPrice', null],
    ],
    kept: true,
  },
  {
    name: 'a blank Plus commission base price',
    cells: [['plusCommissionBasePrice', null]],
    kept: true,
  },
  {
    name: 'a blank Plus commission base price and Plus price upper limit',
    cells: [
      ['plusCommissionBasePrice', null],
      ['plusPriceUpperLimit', null],
    ],
    kept: true,
  },
  { name: 'a blank current price', cells: [['currentPrice', null]], kept: true },
  { name: 'a blank current commission', cells: [['currentCommission', null]], kept: true },
  { name: 'a blank Plus price upper limit', cells: [['plusPriceUpperLimit', null]], kept: true },
  {
    name: 'a blank period offer',
    cells: [],
    blockCells: [{ block: 'periods', index: 0, column: 'offer', value: null }],
    kept: true,
  },
  {
    name: 'a zero period offer',
    cells: [],
    blockCells: [{ block: 'periods', index: 0, column: 'offer', value: 0 }],
    kept: true,
  },
  {
    name: 'a blank title and blank optional columns',
    cells: [
      ['productTitle', null],
      ['size', null],
      ['category', null],
      ['brand', null],
      ['stock', null],
      ['externalId', null],
      ['tariffGroup', null],
      ['cancelled', null],
    ],
    kept: true,
  },
  { name: 'a decimal stock number', cells: [['stock', 12.7]], kept: true },
  { name: 'a decimal stock text', cells: [['stock', '12.7']], kept: true },
  { name: 'a non-numeric stock text', cells: [['stock', 'many']], kept: true },
  {
    name: 'dot thousands with a decimal comma',
    cells: [
      ['currentPrice', '1.234,56'],
      ['commissionBasePrice', '1.199,99'],
      ['plusPriceUpperLimit', '1.099,95'],
      ['plusCommissionBasePrice', '1.000,5'],
      ['currentCommission', '19,5'],
    ],
    blockCells: [{ block: 'periods', index: 0, column: 'offer', value: '12,5' }],
    kept: true,
  },
  {
    name: 'dot-only text prices',
    cells: [
      ['currentPrice', '1.250'],
      ['plusPriceUpperLimit', '1.100'],
    ],
    kept: true,
  },
  {
    name: 'lira-suffixed prices and offer',
    cells: [
      ['currentPrice', '360 TL'],
      ['commissionBasePrice', '350 TL'],
      ['plusPriceUpperLimit', '292 TL'],
    ],
    blockCells: [{ block: 'periods', index: 0, column: 'offer', value: '15 TL' }],
    kept: true,
  },
  { name: 'the text "1" in the cancel cell', cells: [['cancelled', '1']], kept: true },
  { name: 'a fraction in the cancel cell', cells: [['cancelled', 0.5]], kept: true },
  { name: 'a negative number in the cancel cell', cells: [['cancelled', -1]], kept: true },
  { name: 'the no label in the cancel cell', cells: [['cancelled', NO_LABEL]], kept: true },
  { name: 'a number barcode', cells: [['barcode', 8690000000001]], kept: true },
  {
    name: 'negative values the export never writes',
    cells: [
      ['currentPrice', -5],
      ['commissionBasePrice', '-2'],
      ['currentCommission', -1],
      ['plusCommissionBasePrice', -3],
    ],
    kept: true,
  },
];

const ADVANTAGE_DERIVED: readonly DerivedRow<typeof trendyolAdvantageTariffLayout>[] = [
  { name: 'a blank barcode', cells: [['barcode', null]], kept: false },
  { name: 'a blank current price', cells: [['currentPrice', null]], kept: false },
  // Added after the move, so the derived golden pins every mapping rule of the advantage
  // row: the star tiers (a tier without an upper limit is skipped, a lower limit that
  // does not read is left out, a row without any tier), both case-folded yes flags and
  // the column each one reads, the plain grammar of the price and limit cells (number
  // cells, dot thousands with a decimal comma, a dot-only text, a lira suffix), the
  // customer price fallback, the truncated stock, a number barcode and the title
  // fallback. The fixture row's prices and limits are decimal-comma texts.
  { name: 'tier 2 without an upper limit', cells: [['tier2Upper', null]], kept: true },
  {
    name: 'tiers 1 and 2 without a readable lower limit',
    cells: [
      ['tier1Lower', null],
      ['tier2Lower', 'none'],
    ],
    kept: true,
  },
  {
    name: 'no tier at all',
    cells: [
      ['tier1Upper', null],
      ['tier2Upper', null],
      ['tier3Upper', null],
    ],
    kept: true,
  },
  { name: 'the tariff flag VAR', cells: [['commissionTariffFlag', 'VAR']], kept: true },
  { name: 'the tariff flag Yok', cells: [['commissionTariffFlag', 'Yok']], kept: true },
  { name: 'the apply-until-end flag EVET', cells: [['applyUntilEnd', 'EVET']], kept: true },
  { name: 'the apply-until-end flag evet', cells: [['applyUntilEnd', 'evet']], kept: true },
  { name: 'a blank apply-until-end flag', cells: [['applyUntilEnd', null]], kept: true },
  {
    name: 'each yes text in the other flag',
    cells: [
      ['commissionTariffFlag', 'Evet'],
      ['applyUntilEnd', 'Var'],
    ],
    kept: true,
  },
  {
    name: 'number price and limit cells',
    cells: [
      ['currentPrice', 399.9],
      ['customerPrice', 379],
      ['tier1Upper', 350],
      ['tier1Lower', 300.5],
    ],
    kept: true,
  },
  {
    name: 'dot thousands with a decimal comma',
    cells: [
      ['currentPrice', '1.234,56'],
      ['tier1Upper', '1.199,99'],
    ],
    kept: true,
  },
  { name: 'a dot-only text limit', cells: [['tier3Upper', '1.250']], kept: true },
  { name: 'a lira-suffixed current price', cells: [['currentPrice', '360 TL']], kept: false },
  { name: 'a lira-suffixed tier limit', cells: [['tier1Upper', '292 TL']], kept: true },
  {
    name: 'a blank customer price',
    cells: [
      ['customerPrice', null],
      ['currentPrice', '399,90'],
    ],
    kept: true,
  },
  {
    name: 'a lira-suffixed customer price',
    cells: [
      ['customerPrice', '350 TL'],
      ['currentPrice', 410],
    ],
    kept: true,
  },
  { name: 'a decimal stock number', cells: [['stock', 12.7]], kept: true },
  { name: 'a decimal stock text', cells: [['stock', '12.7']], kept: true },
  { name: 'a non-numeric stock text', cells: [['stock', 'many']], kept: true },
  { name: 'a number barcode', cells: [['barcode', 8690000000001]], kept: true },
  {
    name: 'a blank title and blank optional columns',
    cells: [
      ['productTitle', null],
      ['size', null],
      ['modelCode', null],
      ['category', null],
      ['brand', null],
      ['stock', null],
      ['commissionTariffFlag', null],
      ['externalId', null],
      ['tariffGroup', null],
    ],
    kept: true,
  },
];

const FLASH_DERIVED: readonly DerivedRow<typeof trendyolFlashProductListLayout>[] = [
  { name: 'a blank barcode', cells: [['barcode', null]], kept: false },
  { name: 'a blank current price', cells: [['currentPrice', null]], kept: false },
  {
    name: 'neither offer price',
    cells: [
      ['offer24Price', null],
      ['offer3Price', null],
    ],
    kept: false,
  },
  {
    name: 'only a 3-hour offer price',
    cells: [
      ['offer24Price', null],
      ['offer3Price', 149.9],
    ],
    kept: true,
  },
  // Added after the move, so the derived golden pins every mapping rule of the flash
  // row: the offer each price makes and its window (text, date, unreadable), the
  // customer price fallback, a blank current commission read as null (never 0), the
  // folded tariff flag, the truncated stock and the title fallback. An unreadable
  // current commission (also read as null) is pinned by the format's unit test only, so
  // the digest changed for one reason alone when unknown commissions became null.
  {
    name: 'only a 24-hour offer price',
    cells: [
      ['offer24Price', 199.9],
      ['offer3Price', null],
    ],
    kept: true,
  },
  {
    name: 'both offers, the 3-hour window as text',
    cells: [
      ['offer3Price', 99.9],
      ['offer3Start', '08/07/2026 09:00'],
      ['offer3End', '08/07/2026 12:00'],
    ],
    kept: true,
  },
  {
    name: 'a 3-hour window without a 3-hour price',
    cells: [
      ['offer3Price', null],
      ['offer3Start', '08/07/2026 09:00'],
      ['offer3End', '08/07/2026 12:00'],
    ],
    kept: true,
  },
  {
    name: 'an unreadable window start beside a readable end',
    cells: [['offer24Start', 'not a window']],
    kept: true,
  },
  {
    name: 'date-typed window cells, the end an invalid date',
    cells: [
      ['offer24Start', new Date(Date.UTC(2026, 6, 8, 9, 0))],
      ['offer24End', new Date(Number.NaN)],
    ],
    kept: true,
  },
  { name: 'a decimal-comma text offer price', cells: [['offer24Price', '179,47']], kept: true },
  {
    name: 'a TL-suffixed text 24-hour price beside a 3-hour price',
    cells: [
      ['offer24Price', '179 TL'],
      ['offer3Price', 99.9],
    ],
    kept: true,
  },
  { name: 'a blank customer price', cells: [['customerPrice', null]], kept: true },
  { name: 'a blank current commission', cells: [['currentCommission', null]], kept: true },
  { name: 'the tariff flag VAR', cells: [['commissionTariffFlag', 'VAR']], kept: true },
  { name: 'the tariff flag Yok', cells: [['commissionTariffFlag', 'Yok']], kept: true },
  { name: 'a decimal stock number', cells: [['stock', 12.7]], kept: true },
  { name: 'a decimal stock text', cells: [['stock', '12.7']], kept: true },
  { name: 'a non-numeric stock text', cells: [['stock', 'many']], kept: true },
  {
    name: 'a blank title and blank optional columns',
    cells: [
      ['productTitle', null],
      ['modelCode', null],
      ['category', null],
      ['brand', null],
      ['stock', null],
      ['commissionTariffFlag', null],
      ['campaignedProduct', null],
      ['externalId', null],
    ],
    kept: true,
  },
];

const DISCOUNT_DERIVED: readonly DerivedRow<typeof trendyolDiscountListLayout>[] = [
  { name: 'a blank barcode', cells: [['barcode', null]], kept: false },
  { name: 'a blank current price', cells: [['currentPrice', null]], kept: false },
  // Added after the move, so the derived golden pins kept rows too: the flag compares
  // exactly (a lower-case yes is not a yes), and the title falls back to the barcode.
  { name: 'a lower-case yes flag', cells: [['included', 'evet']], kept: true },
  {
    name: 'a blank title and blank optional columns',
    cells: [
      ['externalId', null],
      ['productTitle', null],
      ['brand', null],
      ['color', null],
      ['modelCode', null],
    ],
    kept: true,
  },
];

/** Dot-thousands lira text: the currency grammar reads 1250, the plain grammar nothing. */
const CAMPAIGN_LIRA_TEXT: DerivedRow<typeof trendyolMarketplaceCampaignListLayout> = {
  name: 'dot-thousands lira text prices',
  cells: [
    ['currentPrice', '1.250 ₺'],
    ['maxPrice', '1.250 ₺'],
  ],
  kept: true,
};

const CAMPAIGN_DERIVED: readonly DerivedRow<typeof trendyolMarketplaceCampaignListLayout>[] = [
  { name: 'a blank barcode', cells: [['barcode', null]], kept: false },
  { name: 'a blank current price', cells: [['currentPrice', null]], kept: false },
  { name: 'a blank maximum price', cells: [['maxPrice', null]], kept: false },
  CAMPAIGN_LIRA_TEXT,
  {
    name: 'TL-prefixed text prices',
    cells: [
      ['currentPrice', 'TL 250'],
      ['maxPrice', 'TL 250'],
    ],
    kept: false,
  },
  // Added after the move, so the derived golden pins every mapping rule of the campaign
  // row: the title falls back to the barcode, a stock that is not a plain integer reads
  // as null, and the tariff flag compares exactly (a lower-case yes is not a yes).
  {
    name: 'a blank title and blank optional columns',
    cells: [
      ['productTitle', null],
      ['productCode', null],
      ['category', null],
      ['brand', null],
      ['color', null],
      ['size', null],
      ['stockCode', null],
      ['externalId', null],
    ],
    kept: true,
  },
  { name: 'a decimal stock text', cells: [['stock', '12.5']], kept: true },
  { name: 'a decimal stock number', cells: [['stock', 12.5]], kept: true },
  {
    name: 'a lower-case tariff flag',
    cells: [['commissionTariffFlag', TARIFF_FLAG_YES_FOLDED]],
    kept: true,
  },
  {
    name: 'a tariff flag',
    cells: [['commissionTariffFlag', CAMPAIGN_TARIFF_FLAG_YES]],
    kept: true,
  },
];

// Exported as a list: the blocks above keep the exact bytes they had in the layout test,
// apart from the cases added to every block since the move.
export {
  ADVANTAGE_DERIVED,
  CAMPAIGN_DERIVED,
  CAMPAIGN_LIRA_TEXT,
  COMMISSION_DERIVED,
  DISCOUNT_DERIVED,
  FLASH_DERIVED,
  PLUS_CANCEL_NUMBER_ONE,
  PLUS_CANCEL_TEXT_ZERO,
  PLUS_CANCEL_YES_LABEL,
  PLUS_DERIVED,
};

/**
 * `fixtureGrid` plus one row per case: each a copy of the fixture's first data row that
 * passes `keep`, with the case's cells, then its block cells, written over it. The keep
 * rule chooses the row, not a legacy parser, so the helper outlives the legacy code.
 */
export function derivedGrid<S extends LayoutSpec>(
  spec: S,
  keep: RowPredicate<ColumnKey<S>>,
  fixtureGrid: SheetData,
  cases: readonly DerivedRow<S>[],
): SheetData {
  const layout = resolveLayout(spec, fixtureGrid);
  if (layout === null) throw new Error('The fixture layout did not resolve');
  const first = fixtureGrid
    .slice(layout.headerRowIndex + 1)
    .find((row) => evaluate(keep, row, spec, layout));
  if (first === undefined) throw new Error('The fixture has no kept row');
  const derived = cases.map((testCase): CellValue[] => {
    const row = [...first];
    for (const [key, value] of testCase.cells) {
      const col = columnIndex(spec, layout, key);
      if (col === null) throw new Error(`Derived column "${key}" did not resolve`);
      row[col] = value;
    }
    for (const cell of testCase.blockCells ?? []) {
      const col = layout.blocks.get(cell.block)?.[cell.index]?.columns.get(cell.column);
      if (col === undefined) {
        throw new Error(`Derived block column "${cell.block}.${cell.column}" did not resolve`);
      }
      row[col] = cell.value;
    }
    return row;
  });
  return [...fixtureGrid, ...derived];
}
