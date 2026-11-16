// The marketplace campaign adapter's export half on its own: the price each selection
// writes into the campaign price cell (literal money cases), and the cursor-zip pairing
// of the stored rows with the list's items through planExport. The pairing cases came
// from the legacy export test; a row and an item that disagree are now ROW_MISMATCH
// instead of a silently skipped row (the deliberate change of the pipeline).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Prisma } from '@pazarsync/db';
import { CampaignPriceSelection } from '@pazarsync/db/enums';
import {
  columnIndex,
  readWorkbookGrid,
  resolveLayout,
  type CellValue,
  type ResolvedLayout,
  type SheetData,
} from '@pazarsync/spreadsheet';
import { describe, expect, it, vi } from 'vitest';

import { WorkbookConflictError } from '@/lib/errors';
import type { WriteContext } from '@/workbooks/adapter';
import { planExport } from '@/workbooks/export-plan';
import {
  trendyolMarketplaceCampaignListFormat,
  type MarketplaceCampaignListWriteKey,
} from '@/workbooks/formats/trendyol/marketplace-campaign-list.format';
import {
  marketplaceCampaignListAdapter,
  type MarketplaceCampaignExportItem,
} from '@/workbooks/verticals/marketplace-campaign-list.adapter';
import { resolveWriteColumns } from '@/workbooks/write-columns';

// The fixture header is read through the parse worker, whose cold start can pass
// vitest's 5 s default under load.
vi.setConfig({ testTimeout: 60_000 });

const FIXTURE = readFileSync(
  resolve(__dirname, '../../../fixtures/marketplace-campaign-sample.xlsx'),
);

const adapter = marketplaceCampaignListAdapter;
const format = trendyolMarketplaceCampaignListFormat;

function item(
  barcode: string,
  selection: CampaignPriceSelection,
  maxPrice: string,
  customPrice: string | null = null,
): MarketplaceCampaignExportItem {
  return {
    barcode,
    selection,
    maxPrice: new Prisma.Decimal(maxPrice),
    customPrice: customPrice === null ? null : new Prisma.Decimal(customPrice),
  };
}

/** The write context of a single-file row: the item alone, an empty source cell. */
function writeContext(
  exportItem: MarketplaceCampaignExportItem,
): WriteContext<MarketplaceCampaignExportItem, MarketplaceCampaignListWriteKey> {
  return {
    window: null,
    pick: null,
    items: [{ tag: null, item: exportItem }],
    source: { text: () => null, decimal: () => null },
  };
}

describe('marketplace campaign adapter: the written campaign price', () => {
  it('writes the maximum price for MAX, at two decimal places', () => {
    const writes = adapter.resolveWriteBack(
      writeContext(item('BC-1', CampaignPriceSelection.MAX, '149.9')),
    );

    expect(writes).toEqual([{ key: 'campaignPrice', value: '149.90' }]);
  });

  it('writes a whole maximum price with two decimal places', () => {
    const writes = adapter.resolveWriteBack(
      writeContext(item('BC-1', CampaignPriceSelection.MAX, '249')),
    );

    expect(writes).toEqual([{ key: 'campaignPrice', value: '249.00' }]);
  });

  it('writes the custom price for CUSTOM, at two decimal places', () => {
    const writes = adapter.resolveWriteBack(
      writeContext(item('BC-1', CampaignPriceSelection.CUSTOM, '249', '120')),
    );

    expect(writes).toEqual([{ key: 'campaignPrice', value: '120.00' }]);
  });

  it('writes a custom price with one decimal as two', () => {
    const writes = adapter.resolveWriteBack(
      writeContext(item('BC-1', CampaignPriceSelection.CUSTOM, '249', '199.9')),
    );

    expect(writes).toEqual([{ key: 'campaignPrice', value: '199.90' }]);
  });

  it('writes nothing for CUSTOM without a custom price', () => {
    const writes = adapter.resolveWriteBack(
      writeContext(item('BC-1', CampaignPriceSelection.CUSTOM, '249')),
    );

    expect(writes).toEqual([]);
  });

  it('writes nothing without a selection, even with a stale custom price', () => {
    expect(
      adapter.resolveWriteBack(writeContext(item('BC-1', CampaignPriceSelection.NONE, '249'))),
    ).toEqual([]);
    expect(
      adapter.resolveWriteBack(
        writeContext(item('BC-1', CampaignPriceSelection.NONE, '249', '200')),
      ),
    ).toEqual([]);
  });
});

/** One data row of a synthetic sheet: barcode, current price, maximum price (null: blank). */
type SyntheticRow = readonly [string, number, number | null];

/** The real header and the given rows, every other cell blank. */
async function syntheticSheet(
  rows: readonly SyntheticRow[],
): Promise<{ grid: SheetData; layout: ResolvedLayout }> {
  const header = (await readWorkbookGrid(FIXTURE, { sheet: format.sheet }))[0] ?? [];
  const headerLayout = resolveLayout(format.layout, [header]);
  if (headerLayout === null) throw new Error('the fixture header does not resolve');
  const col = (key: 'barcode' | 'currentPrice' | 'maxPrice'): number => {
    const index = columnIndex(format.layout, headerLayout, key);
    if (index === null) throw new Error(`the ${key} column did not resolve`);
    return index;
  };
  const grid: SheetData = [
    header,
    ...rows.map(([barcode, currentPrice, maxPrice]): CellValue[] => {
      const row: CellValue[] = header.map(() => null);
      row[col('barcode')] = barcode;
      row[col('currentPrice')] = currentPrice;
      row[col('maxPrice')] = maxPrice;
      return row;
    }),
  ];
  const layout = resolveLayout(format.layout, grid);
  if (layout === null) throw new Error('the synthetic sheet does not resolve');
  return { grid, layout };
}

// Four data rows: B-002 has no maximum price, so the import dropped it; the other three
// carry a MAX, a CUSTOM and a NONE selection.
const ROWS: readonly SyntheticRow[] = [
  ['A-001', 100, 120],
  ['B-002', 200, null],
  ['C-003', 150, 180],
  ['D-004', 90, 110],
];

async function plan(items: readonly MarketplaceCampaignExportItem[]) {
  const { grid, layout } = await syntheticSheet(ROWS);
  return planExport({
    format,
    grid,
    layout,
    resolved: resolveWriteColumns(format, layout),
    groups: [{ tag: null, items }],
    adapter,
  });
}

async function conflictReason(items: readonly MarketplaceCampaignExportItem[]): Promise<string> {
  try {
    await plan(items);
  } catch (err) {
    if (err instanceof WorkbookConflictError) return err.reason;
    throw err;
  }
  throw new Error('the export plan did not refuse the items');
}

describe('marketplace campaign adapter: pairing rows and items', () => {
  it("writes each price into its own product's row; the dropped and NONE rows stay blank", async () => {
    const result = await plan([
      item('A-001', CampaignPriceSelection.MAX, '120'),
      item('C-003', CampaignPriceSelection.CUSTOM, '180', '170'),
      item('D-004', CampaignPriceSelection.NONE, '110'),
    ]);

    expect(result.files).toEqual([
      {
        dayCount: null,
        patches: [
          { excelRow: 2, col: 11, value: { kind: 'number', value: '120.00', scale: 2 } },
          { excelRow: 4, col: 11, value: { kind: 'number', value: '170.00', scale: 2 } },
        ],
      },
    ]);
    expect(result.anchors).toEqual([
      { excelRow: 2, col: 0, expected: 'A-001' },
      { excelRow: 4, col: 0, expected: 'C-003' },
    ]);
    expect(result.overwriteFormulaColumns).toEqual([11]);
  });

  it('refuses fewer items than kept rows with ROW_MISMATCH', async () => {
    const reason = await conflictReason([
      item('A-001', CampaignPriceSelection.MAX, '120'),
      item('C-003', CampaignPriceSelection.CUSTOM, '180', '170'),
    ]);

    expect(reason).toBe('ROW_MISMATCH');
  });

  it('refuses an item whose barcode is not its row with ROW_MISMATCH', async () => {
    const reason = await conflictReason([
      item('A-001', CampaignPriceSelection.MAX, '120'),
      item('X-999', CampaignPriceSelection.CUSTOM, '180', '170'),
      item('D-004', CampaignPriceSelection.NONE, '110'),
    ]);

    expect(reason).toBe('ROW_MISMATCH');
  });
});
