// The advantage tariff adapter on its own: the new sale price each item carries (its
// pick, literal money cases moved from the legacy export price test), what the pick
// writes, how the anchor map picks among items that share a barcode, and the upload
// form's commission source with its scoped lookup (the database mocked; the
// cross-tenant cases run against the real database in the isolation matrix).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Prisma } from '@pazarsync/db';
import {
  columnIndex,
  readWorkbookGrid,
  resolveLayout,
  type CellValue,
  type ColumnKey,
  type ResolvedLayout,
  type SheetData,
} from '@pazarsync/spreadsheet';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ValidationError, WorkbookConflictError } from '@/lib/errors';
import type { WriteContext } from '@/workbooks/adapter';
import { planExport } from '@/workbooks/export-plan';
import {
  trendyolAdvantageTariffFormat,
  type AdvantageTariffWriteKey,
} from '@/workbooks/formats/trendyol/advantage-tariff.format';
import {
  advantageTariffAdapter,
  resolveAdvantageExportPrice,
  type AdvantageTariffExportItem,
} from '@/workbooks/verticals/advantage-tariff.adapter';
import { resolveWriteColumns } from '@/workbooks/write-columns';

const mocks = vi.hoisted(() => ({ findCommissionTariff: vi.fn() }));

// Only the commission source lookup of `inspect` reaches the database in this file.
vi.mock('@pazarsync/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pazarsync/db')>()),
  prisma: { commissionTariff: { findFirst: mocks.findCommissionTariff } },
}));

// The fixture header is read through the parse worker, whose cold start can pass
// vitest's 5 s default under load.
vi.setConfig({ testTimeout: 60_000 });

const FIXTURE = readFileSync(
  resolve(__dirname, '../../../fixtures/trendyol-advantage-tariff.xlsx'),
);

const adapter = advantageTariffAdapter;
const format = trendyolAdvantageTariffFormat;

const SCOPE = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  storeId: '22222222-2222-4222-8222-222222222222',
};
const SOURCE_TARIFF_ID = '33333333-3333-4333-8333-333333333333';

// The stored tiers of the legacy export price test.
const TIERS: Prisma.JsonValue = [
  { key: 'tier1', upperLimit: '292.91', lowerLimit: '274.43' },
  { key: 'tier2', upperLimit: '274.42', lowerLimit: '223.79' },
  { key: 'tier3', upperLimit: '223.78' },
];

// Tiers whose tier 2 upper limit is a whole number.
const WHOLE_TIERS: Prisma.JsonValue = [
  { key: 'tier1', upperLimit: '180', lowerLimit: '150.01' },
  { key: 'tier2', upperLimit: '150', lowerLimit: '120.01' },
  { key: 'tier3', upperLimit: '120' },
];

function item(
  barcode: string,
  selectedTier: string | null,
  customPrice: string | null,
  starTiers: Prisma.JsonValue = TIERS,
): AdvantageTariffExportItem {
  return {
    barcode,
    selectedTier,
    customPrice: customPrice === null ? null : new Prisma.Decimal(customPrice),
    starTiers,
  };
}

afterEach(() => {
  mocks.findCommissionTariff.mockReset();
});

describe('advantage tariff adapter: the new sale price an item carries (pick)', () => {
  it('is the custom price, at two decimal places', () => {
    expect(resolveAdvantageExportPrice(item('BC-1', null, '199.9'))).toBe('199.90');
  });

  it("is the selected tier's upper limit, at two decimal places", () => {
    expect(resolveAdvantageExportPrice(item('BC-1', 'tier2', null, WHOLE_TIERS))).toBe('150.00');
    expect(resolveAdvantageExportPrice(item('BC-1', 'tier2', null))).toBe('274.42');
  });

  it('is the custom price when a tier is selected too', () => {
    expect(resolveAdvantageExportPrice(item('BC-1', 'tier2', '199.9', WHOLE_TIERS))).toBe('199.90');
    expect(resolveAdvantageExportPrice(item('BC-1', 'tier1', '150.00'))).toBe('150.00');
  });

  // A confirmed custom price is stored with no tier; the legacy export once skipped it.
  it('is the custom price of a custom-only row (no tier)', () => {
    expect(resolveAdvantageExportPrice(item('BC-1', null, '139.00'))).toBe('139.00');
    expect(resolveAdvantageExportPrice(item('BC-1', null, '139'))).toBe('139.00');
  });

  it('is null without a tier or a custom price', () => {
    expect(resolveAdvantageExportPrice(item('BC-1', null, null))).toBeNull();
  });

  it('is null when the selected tier is not in the stored tiers', () => {
    expect(resolveAdvantageExportPrice(item('BC-1', 'tier3', null, []))).toBeNull();
    expect(resolveAdvantageExportPrice(item('BC-1', 'tier3', null, { tier3: '1' }))).toBeNull();
  });

  it('is the pick the export plans with', () => {
    expect(adapter.pick(item('BC-1', 'tier2', null, WHOLE_TIERS))).toBe('150.00');
    expect(adapter.pick(item('BC-1', null, null))).toBeNull();
  });
});

describe('advantage tariff adapter: what the pick writes', () => {
  function writeContext(
    pick: string | null,
    exportItem: AdvantageTariffExportItem,
  ): WriteContext<AdvantageTariffExportItem, AdvantageTariffWriteKey> {
    return {
      window: null,
      pick,
      items: [{ tag: null, item: exportItem }],
      source: { text: () => null, decimal: () => null },
    };
  }

  it('writes the pick into the new sale price column', () => {
    expect(adapter.resolveWriteBack(writeContext('150.00', item('BC-1', 'tier2', null)))).toEqual([
      { key: 'newTsf', value: '150.00' },
    ]);
  });

  it('writes nothing without a pick', () => {
    expect(adapter.resolveWriteBack(writeContext(null, item('BC-1', null, null)))).toEqual([]);
  });
});

/** One data row of a synthetic sheet: barcode, current price (null: blank). */
type SyntheticRow = readonly [string, number | null];

type AdvantageColumn = ColumnKey<typeof format.layout>;

/** The real header and the given rows, every other cell blank. */
async function syntheticSheet(
  rows: readonly SyntheticRow[],
): Promise<{ grid: SheetData; layout: ResolvedLayout }> {
  const header = (await readWorkbookGrid(FIXTURE, { sheet: format.sheet }))[0] ?? [];
  const headerLayout = resolveLayout(format.layout, [header]);
  if (headerLayout === null) throw new Error('the fixture header does not resolve');
  const col = (key: AdvantageColumn): number => {
    const index = columnIndex(format.layout, headerLayout, key);
    if (index === null) throw new Error(`the ${key} column did not resolve`);
    return index;
  };
  const grid: SheetData = [
    header,
    ...rows.map(([barcode, currentPrice]): CellValue[] => {
      const row: CellValue[] = header.map(() => null);
      row[col('barcode')] = barcode;
      row[col('currentPrice')] = currentPrice;
      return row;
    }),
  ];
  const layout = resolveLayout(format.layout, grid);
  if (layout === null) throw new Error('the synthetic sheet does not resolve');
  return { grid, layout };
}

// Four data rows: B-002 has no current price, so the import dropped it, but the export
// still patches it; the fourth row repeats A-001's barcode.
const ROWS: readonly SyntheticRow[] = [
  ['A-001', 100],
  ['B-002', null],
  ['C-003', 150],
  ['A-001', 100],
];

// The new sale price column (P) and the barcode column (B) of the real header.
const NEW_TSF_COL = 15;
const BARCODE_COL = 1;

async function plan(items: readonly AdvantageTariffExportItem[]) {
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

function priceAt(excelRow: number, value: string) {
  return { excelRow, col: NEW_TSF_COL, value: { kind: 'number', value, scale: 2 } };
}

describe('advantage tariff adapter: the anchor map', () => {
  it('writes every row of a barcode, a row the import dropped included', async () => {
    const result = await plan([
      item('A-001', 'tier2', null, WHOLE_TIERS),
      item('B-002', null, '89.9'),
      item('C-003', null, null),
    ]);

    expect(result.files).toEqual([
      {
        dayCount: null,
        patches: [priceAt(2, '150.00'), priceAt(3, '89.90'), priceAt(5, '150.00')],
      },
    ]);
    expect(result.anchors).toEqual([
      { excelRow: 2, col: BARCODE_COL, expected: 'A-001' },
      { excelRow: 3, col: BARCODE_COL, expected: 'B-002' },
      { excelRow: 5, col: BARCODE_COL, expected: 'A-001' },
    ]);
    expect(result.overwriteFormulaColumns).toEqual([NEW_TSF_COL]);
  });

  it('keeps a priced item when a later item of its barcode carries no price', async () => {
    const result = await plan([item('A-001', null, '120'), item('A-001', null, null)]);

    expect(result.files[0]?.patches).toEqual([priceAt(2, '120.00'), priceAt(5, '120.00')]);
  });

  it('writes a priced item that follows an unpriced item of its barcode', async () => {
    const result = await plan([item('A-001', null, null), item('A-001', null, '120')]);

    expect(result.files[0]?.patches).toEqual([priceAt(2, '120.00'), priceAt(5, '120.00')]);
  });

  it('writes the later of two priced items of one barcode', async () => {
    const result = await plan([
      item('A-001', null, '120'),
      item('A-001', 'tier2', null, WHOLE_TIERS),
    ]);

    expect(result.files[0]?.patches).toEqual([priceAt(2, '150.00'), priceAt(5, '150.00')]);
  });

  it('writes nothing for items without a price, one whose barcode is not in the file included', async () => {
    const result = await plan([item('A-001', null, null), item('X-999', null, null)]);

    expect(result.files).toEqual([{ dayCount: null, patches: [] }]);
    expect(result.anchors).toEqual([]);
  });

  it('refuses a priced item whose barcode is not in the file with ROW_MISMATCH', async () => {
    let thrown: unknown = null;
    try {
      await plan([item('A-001', null, '120'), item('X-999', null, '120')]);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(WorkbookConflictError);
    expect(thrown instanceof WorkbookConflictError ? thrown.reason : null).toBe('ROW_MISMATCH');
  });
});

describe('advantage tariff adapter: the commission source of the upload form', () => {
  const file = new File([new Uint8Array(FIXTURE)], 'advantage.xlsx');

  it('reads a blank or absent commission source as none', () => {
    expect(adapter.readForm({ file, commissionSourceTariffId: '' }).config).toEqual({
      commissionSourceTariffId: null,
    });
    expect(adapter.readForm({ file }).config).toEqual({ commissionSourceTariffId: null });
  });

  it('reads a commission source id as it is', () => {
    const form = adapter.readForm({
      file,
      name: 'Week 1',
      commissionSourceTariffId: SOURCE_TARIFF_ID,
    });

    expect(form.config).toEqual({ commissionSourceTariffId: SOURCE_TARIFF_ID });
    expect(form.name).toBe('Week 1');
    expect(form.file).toBe(file);
  });

  it('does not query the database without a commission source', async () => {
    await expect(
      adapter.inspect({
        scope: SCOPE,
        config: { commissionSourceTariffId: null },
        now: new Date(),
        rows: [],
        firstDataRow: null,
      }),
    ).resolves.toBeUndefined();
    expect(mocks.findCommissionTariff).not.toHaveBeenCalled();
  });

  it("looks the commission source up in the store's own scope", async () => {
    mocks.findCommissionTariff.mockResolvedValue({ id: SOURCE_TARIFF_ID });

    await expect(
      adapter.inspect({
        scope: SCOPE,
        config: { commissionSourceTariffId: SOURCE_TARIFF_ID },
        now: new Date(),
        rows: [],
        firstDataRow: null,
      }),
    ).resolves.toBeUndefined();
    expect(mocks.findCommissionTariff).toHaveBeenCalledTimes(1);
    expect(mocks.findCommissionTariff).toHaveBeenCalledWith({
      where: { id: SOURCE_TARIFF_ID, organizationId: SCOPE.organizationId, storeId: SCOPE.storeId },
      select: { id: true },
    });
  });

  it('refuses a commission source the scope does not hold with INVALID_COMMISSION_SOURCE', async () => {
    mocks.findCommissionTariff.mockResolvedValue(null);

    const err: unknown = await adapter
      .inspect({
        scope: SCOPE,
        config: { commissionSourceTariffId: SOURCE_TARIFF_ID },
        now: new Date(),
        rows: [],
        firstDataRow: null,
      })
      .then(
        () => null,
        (rejection: unknown) => rejection,
      );

    expect(err).toBeInstanceOf(ValidationError);
    if (!(err instanceof ValidationError)) return;
    expect(err.issues).toEqual([
      { field: 'commissionSourceTariffId', code: 'INVALID_COMMISSION_SOURCE' },
    ]);
  });
});
