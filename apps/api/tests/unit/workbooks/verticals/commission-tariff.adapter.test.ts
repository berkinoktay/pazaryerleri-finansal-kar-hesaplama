// The commission tariff adapter on its own: the bands an import stores per period
// (`bandsForPeriod`, from the format), the price each item carries (its pick, literal
// money cases), what a covered row writes (the price and the window's tariff selection),
// how the window files and the anchor map pick among periods and repeated barcodes, the
// week check of the upload (the database mocked; the persist re-check runs against the
// real database in commission-tariffs-duplicate-week.routes.test.ts) with its count of
// rows priced by neither file price, and the form, name and response.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Prisma } from '@pazarsync/db';
import {
  columnIndex,
  createRowReader,
  readWorkbookGrid,
  resolveLayout,
  SpreadsheetFileError,
  type CellPatch,
  type CellValue,
  type ResolvedLayout,
  type SheetData,
} from '@pazarsync/spreadsheet';
import { businessZoneEpochToInstant } from '@pazarsync/utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NotFoundError, WorkbookConflictError, type WorkbookConflictReason } from '@/lib/errors';
import type { ExportGroup, ImportedRow, WriteContext } from '@/workbooks/adapter';
import { planExport } from '@/workbooks/export-plan';
import {
  bandsForPeriod,
  trendyolCommissionTariffFormat,
  type CommissionTariffBrackets,
  type CommissionTariffRow,
  type CommissionTariffWriteKey,
} from '@/workbooks/formats/trendyol/commission-tariff.format';
import { TARIFF_WINDOW_LABEL_UNIT } from '@/workbooks/formats/trendyol/labels';
import { TARIFF_PERIODS_REASON, type TariffWeek } from '@/workbooks/tariff-week';
import {
  commissionTariffAdapter,
  importTariff,
  resolveCommissionExportPrice,
  type CommissionTariffExportItem,
} from '@/workbooks/verticals/commission-tariff.adapter';
import { WorkbookFileRejection, WorkbookInvariantError } from '@/workbooks/workbook-errors';
import { resolveWriteColumns } from '@/workbooks/write-columns';

import { blockColumn, blocksOf } from '../../../helpers/layout-blocks';

const mocks = vi.hoisted(() => ({ findTariff: vi.fn(), findStore: vi.fn() }));

// Only the week overlap query of `inspect` and the store lookup of `importTariff` reach
// the database in this file.
vi.mock('@pazarsync/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pazarsync/db')>()),
  prisma: {
    commissionTariff: { findFirst: mocks.findTariff },
    store: { findFirst: mocks.findStore },
  },
}));

// The fixture headers are read through the parse worker, whose cold start can pass
// vitest's 5 s default under load.
vi.setConfig({ testTimeout: 60_000 });

const FIXTURES_DIR = resolve(__dirname, '../../../fixtures');
const MULTI = readFileSync(resolve(FIXTURES_DIR, 'trendyol-commission-tariff.xlsx'));
const SINGLE = readFileSync(resolve(FIXTURES_DIR, 'trendyol-tariff-1period.xlsx'));
const READER_OPTIONS = { toInstant: businessZoneEpochToInstant };

const adapter = commissionTariffAdapter;
const format = trendyolCommissionTariffFormat;

const SCOPE = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  storeId: '22222222-2222-4222-8222-222222222222',
};

/** The tariff selection of a window of `days` days. */
function windowLabel(days: number): string {
  return `${days} ${TARIFF_WINDOW_LABEL_UNIT}`;
}

const BAND2: Prisma.JsonValue = [
  { key: 'band1', commissionPct: '19', lowerLimit: '777.1' },
  { key: 'band2', commissionPct: '13.1', lowerLimit: '753.24', upperLimit: '777.09' },
];

function item(
  barcode: string,
  selectedBand: string | null,
  customPrice: string | null,
  bands: Prisma.JsonValue = BAND2,
  currentPrice: string | null = '285',
): CommissionTariffExportItem {
  return {
    barcode,
    selectedBand,
    customPrice: customPrice === null ? null : new Prisma.Decimal(customPrice),
    currentPrice: currentPrice === null ? null : new Prisma.Decimal(currentPrice),
    bands,
  };
}

/** The reason of the WorkbookConflictError `run` throws; null when it returns. */
function conflictReason(run: () => unknown): WorkbookConflictReason | null {
  try {
    run();
  } catch (err) {
    if (err instanceof WorkbookConflictError) return err.reason;
    throw err;
  }
  return null;
}

afterEach(() => {
  mocks.findTariff.mockReset();
  mocks.findStore.mockReset();
});

describe('commission tariff adapter: the bands an import stores per period (bandsForPeriod)', () => {
  const brackets: CommissionTariffBrackets = {
    band1Lower: '777.1',
    band2Lower: '753.24',
    band2Upper: '777.09',
    band3Lower: '720.78',
    band3Upper: '753.23',
    band4Upper: '720.77',
  };

  it('builds four bands with keys band1 to band4 from four commissions and all limits', () => {
    expect(bandsForPeriod(brackets, ['19', '13.1', '12.1', '10.6'])).toStrictEqual([
      { key: 'band1', commissionPct: '19', lowerLimit: '777.1' },
      { key: 'band2', commissionPct: '13.1', lowerLimit: '753.24', upperLimit: '777.09' },
      { key: 'band3', commissionPct: '12.1', lowerLimit: '720.78', upperLimit: '753.23' },
      { key: 'band4', commissionPct: '10.6', upperLimit: '720.77' },
    ]);
  });

  it('skips a band whose commission is missing; the others keep their keys', () => {
    expect(bandsForPeriod(brackets, ['19', '13.1', null, '10.6']).map((band) => band.key)).toEqual([
      'band1',
      'band2',
      'band4',
    ]);
  });

  it('omits a null limit instead of storing it as null', () => {
    const [band2] = bandsForPeriod({ ...brackets, band2Lower: null }, [null, '13.1', null, null]);

    expect(band2).toStrictEqual({ key: 'band2', commissionPct: '13.1', upperLimit: '777.09' });
    expect(band2 !== undefined && 'lowerLimit' in band2).toBe(false);
  });

  it('gives band 1 only a lower limit and band 4 only an upper limit', () => {
    const bands = bandsForPeriod(brackets, ['19', null, null, '10.6']);

    expect(bands).toStrictEqual([
      { key: 'band1', commissionPct: '19', lowerLimit: '777.1' },
      { key: 'band4', commissionPct: '10.6', upperLimit: '720.77' },
    ]);
  });

  it('skips the bands of the commissions a short list does not hold', () => {
    expect(bandsForPeriod(brackets, ['19', '13.1']).map((band) => band.key)).toEqual([
      'band1',
      'band2',
    ]);
    expect(bandsForPeriod(brackets, [])).toEqual([]);
  });
});

describe('commission tariff adapter: the price an item carries (pick)', () => {
  it('is null without a selected band, even with a custom price', () => {
    expect(resolveCommissionExportPrice(item('BC-1', null, null))).toBeNull();
    expect(resolveCommissionExportPrice(item('BC-1', null, '249.9'))).toBeNull();
  });

  it('is the custom price of a selected item, at two decimal places, over the band price', () => {
    expect(resolveCommissionExportPrice(item('BC-1', 'band2', '249.9'))).toBe('249.90');
    expect(adapter.pick(item('BC-1', 'band2', '249.9'))).toBe('249.90');
  });

  it("is the selected stored band's price without a custom price", () => {
    // band2 has an upper limit: its price; band1 has only a lower limit: that one.
    expect(resolveCommissionExportPrice(item('BC-1', 'band2', null))).toBe('777.09');
    expect(resolveCommissionExportPrice(item('BC-1', 'band1', null))).toBe('777.10');
  });

  it('is the current price for a selected band the stored bands do not hold', () => {
    expect(resolveCommissionExportPrice(item('BC-1', 'band3', null))).toBe('285.00');
  });

  it('is the current price for a selected band with neither limit', () => {
    const bands: Prisma.JsonValue = [{ key: 'band1', commissionPct: '19' }];

    expect(resolveCommissionExportPrice(item('BC-1', 'band1', null, bands, '299.5'))).toBe(
      '299.50',
    );
  });

  it('refuses a selected band with neither limit when the current price is unknown', () => {
    const bands: Prisma.JsonValue = [{ key: 'band1', commissionPct: '19' }];
    const unknown = item('BC-1', 'band1', null, bands, null);

    expect(conflictReason(() => resolveCommissionExportPrice(unknown))).toBe(
      'SELECTION_PRICE_UNKNOWN',
    );
    expect(conflictReason(() => adapter.pick(unknown))).toBe('SELECTION_PRICE_UNKNOWN');
  });

  it('never writes 0.00 for a selected band whose limits are 0: refused when the current price is unknown', () => {
    const zeroLimits: Prisma.JsonValue = [
      { key: 'band1', lowerLimit: '0.00', upperLimit: '0.00', commissionPct: '19' },
    ];

    expect(
      conflictReason(() =>
        resolveCommissionExportPrice(item('BC-1', 'band1', null, zeroLimits, null)),
      ),
    ).toBe('SELECTION_PRICE_UNKNOWN');
  });

  it('refuses a selected band the stored bands do not hold when the current price is unknown', () => {
    expect(
      conflictReason(() => resolveCommissionExportPrice(item('BC-1', 'band3', null, BAND2, null))),
    ).toBe('SELECTION_PRICE_UNKNOWN');
  });

  it('writes the custom price even when the current price is unknown', () => {
    const bands: Prisma.JsonValue = [{ key: 'band1', commissionPct: '19' }];

    expect(resolveCommissionExportPrice(item('BC-1', 'band1', '249.9', bands, null))).toBe(
      '249.90',
    );
    expect(resolveCommissionExportPrice(item('BC-1', 'band3', '249.9', BAND2, null))).toBe(
      '249.90',
    );
  });

  it('is null for an unselected item whose current price is unknown', () => {
    expect(resolveCommissionExportPrice(item('BC-1', null, null, BAND2, null))).toBeNull();
    expect(resolveCommissionExportPrice(item('BC-1', null, '249.9', BAND2, null))).toBeNull();
  });

  it("writes a limited band's price when the current price is unknown", () => {
    // band2 has an upper limit: its price; band1 has only a lower limit: that one.
    expect(resolveCommissionExportPrice(item('BC-1', 'band2', null, BAND2, null))).toBe('777.09');
    expect(resolveCommissionExportPrice(item('BC-1', 'band1', null, BAND2, null))).toBe('777.10');
  });
});

describe('commission tariff adapter: what a covered row writes', () => {
  function writeContext(
    pick: string | null,
    window: WriteContext<CommissionTariffExportItem, CommissionTariffWriteKey>['window'],
  ): WriteContext<CommissionTariffExportItem, CommissionTariffWriteKey> {
    return {
      window,
      pick,
      items: [{ tag: 7, item: item('BC-1', 'band2', null) }],
      source: { text: () => null, decimal: () => null },
    };
  }

  it("writes the pick and the window's tariff selection", () => {
    expect(
      adapter.resolveWriteBack(writeContext('777.09', { dayCount: 3, label: windowLabel(3) })),
    ).toEqual([
      { key: 'newTsf', value: '777.09' },
      { key: 'tariffSelection', value: windowLabel(3) },
    ]);
    expect(
      adapter.resolveWriteBack(writeContext('777.09', { dayCount: 7, label: windowLabel(7) })),
    ).toEqual([
      { key: 'newTsf', value: '777.09' },
      { key: 'tariffSelection', value: windowLabel(7) },
    ]);
  });

  it('writes nothing without a pick', () => {
    expect(
      adapter.resolveWriteBack(writeContext(null, { dayCount: 7, label: windowLabel(7) })),
    ).toEqual([]);
  });

  it('refuses a row without a window: the commission export always writes into a period window', () => {
    expect(() => adapter.resolveWriteBack(writeContext('777.09', null))).toThrow(
      WorkbookInvariantError,
    );
  });
});

/** The real header of `file` and one data row per barcode, every other cell blank. */
async function syntheticSheet(
  file: Buffer,
  barcodes: readonly string[],
): Promise<{ grid: SheetData; layout: ResolvedLayout }> {
  const header = (await readWorkbookGrid(file, { sheet: format.sheet }))[0] ?? [];
  const headerLayout = resolveLayout(format.layout, [header]);
  if (headerLayout === null) throw new Error('the fixture header does not resolve');
  const barcodeCol = columnIndex(format.layout, headerLayout, 'barcode');
  if (barcodeCol === null) throw new Error('the barcode column did not resolve');
  const grid: SheetData = [
    header,
    ...barcodes.map((barcode): CellValue[] => {
      const row: CellValue[] = header.map(() => null);
      row[barcodeCol] = barcode;
      return row;
    }),
  ];
  const layout = resolveLayout(format.layout, grid);
  if (layout === null) throw new Error('the synthetic sheet does not resolve');
  return { grid, layout };
}

async function plan(
  file: Buffer,
  barcodes: readonly string[],
  groups: readonly ExportGroup<CommissionTariffExportItem>[],
) {
  const { grid, layout } = await syntheticSheet(file, barcodes);
  return planExport({
    format,
    grid,
    layout,
    resolved: resolveWriteColumns(format, layout),
    groups,
    adapter,
  });
}

// The write columns of the 3+4 day file (AB, AE) and of the 7 day file (W, Y).
const MULTI_COLS = { price: 27, selection: 30 } as const;
const SINGLE_COLS = { price: 22, selection: 24 } as const;

function price(excelRow: number, col: number, value: string): CellPatch {
  return { excelRow, col, value: { kind: 'number', value, scale: 2 } };
}

function text(excelRow: number, col: number, value: string): CellPatch {
  return { excelRow, col, value: { kind: 'text', value } };
}

describe('commission tariff adapter: the window files', () => {
  it('writes one whole-week file for a price chosen alike in both periods', async () => {
    const result = await plan(
      MULTI,
      ['A-001'],
      [
        { tag: 3, items: [item('A-001', 'band2', null)] },
        { tag: 4, items: [item('A-001', 'band2', null)] },
      ],
    );

    expect(result.files).toEqual([
      {
        dayCount: 7,
        patches: [
          price(2, MULTI_COLS.price, '777.09'),
          text(2, MULTI_COLS.selection, windowLabel(7)),
        ],
      },
    ]);
    expect(result.overwriteFormulaColumns).toEqual([27, 30]);
  });

  it('writes one file per period for different prices', async () => {
    const result = await plan(
      MULTI,
      ['A-001'],
      [
        { tag: 3, items: [item('A-001', 'band2', null)] },
        { tag: 4, items: [item('A-001', 'band2', '700')] },
      ],
    );

    expect(result.files).toEqual([
      {
        dayCount: 3,
        patches: [
          price(2, MULTI_COLS.price, '777.09'),
          text(2, MULTI_COLS.selection, windowLabel(3)),
        ],
      },
      {
        dayCount: 4,
        patches: [
          price(2, MULTI_COLS.price, '700.00'),
          text(2, MULTI_COLS.selection, windowLabel(4)),
        ],
      },
    ]);
  });

  it("writes a 4-day file when the file's first period was dropped at import", async () => {
    const result = await plan(
      MULTI,
      ['A-001'],
      [{ tag: 4, items: [item('A-001', 'band2', null)] }],
    );

    expect(result.files).toEqual([
      {
        dayCount: 4,
        patches: [
          price(2, MULTI_COLS.price, '777.09'),
          text(2, MULTI_COLS.selection, windowLabel(4)),
        ],
      },
    ]);
  });

  it('writes one empty file without a day count when nothing is selected', async () => {
    const result = await plan(SINGLE, ['A-001'], [{ tag: 7, items: [item('A-001', null, null)] }]);

    expect(result.files).toEqual([{ dayCount: null, patches: [] }]);
    expect(result.anchors).toEqual([]);
  });
});

describe('commission tariff adapter: a barcode on several rows', () => {
  it("writes the selected item's price on every row of its barcode", async () => {
    // Rows 2 and 4 carry A-001; the first item is selected, the later one is not.
    const result = await plan(
      SINGLE,
      ['A-001', 'B-002', 'A-001'],
      [
        {
          tag: 7,
          items: [
            item('A-001', 'band2', null),
            item('B-002', null, null),
            item('A-001', null, '99'),
          ],
        },
      ],
    );

    expect(result.files).toEqual([
      {
        dayCount: 7,
        patches: [
          price(2, SINGLE_COLS.price, '777.09'),
          text(2, SINGLE_COLS.selection, windowLabel(7)),
          price(4, SINGLE_COLS.price, '777.09'),
          text(4, SINGLE_COLS.selection, windowLabel(7)),
        ],
      },
    ]);
    expect(result.anchors.map((anchor) => [anchor.excelRow, anchor.expected])).toEqual([
      [2, 'A-001'],
      [4, 'A-001'],
    ]);
  });

  it('writes the later of two selected items of one barcode', async () => {
    const result = await plan(
      SINGLE,
      ['A-001'],
      [{ tag: 7, items: [item('A-001', 'band2', '100'), item('A-001', 'band2', '110')] }],
    );

    expect(result.files[0]?.patches).toContainEqual(price(2, SINGLE_COLS.price, '110.00'));
  });
});

/** A reader over the first data row of `file`. */
async function firstDataRowOf(file: Buffer) {
  const grid = await readWorkbookGrid(file, { sheet: format.sheet });
  const layout = resolveLayout(format.layout, grid);
  if (layout === null) throw new Error('the fixture does not resolve');
  return createRowReader(format.layout, layout, grid[1] ?? [], READER_OPTIONS);
}

/**
 * A reader over the first data row of `file` once its period label and computed
 * commission headers of `from` days say `to` days instead, and, when `firstLabel` is
 * given, its first period block's label is filled on that row.
 */
async function firstDataRowWithDays(
  file: Buffer,
  from: number,
  to: number,
  firstLabel: string | null = null,
) {
  const [header = [], ...rows] = await readWorkbookGrid(file, { sheet: format.sheet });
  const rewritten = header.map((cell) =>
    typeof cell === 'string' && /^(?:Tarih|Hesaplanan) /.test(cell)
      ? cell.replace(`(${from} `, `(${to} `)
      : cell,
  );
  const first = [...(rows[0] ?? [])];
  if (firstLabel !== null) {
    const headerLayout = resolveLayout(format.layout, [rewritten]);
    if (headerLayout === null) throw new Error('the rewritten header does not resolve');
    const firstPeriod = blocksOf(format.layout, headerLayout, 'periods')[0];
    if (firstPeriod === undefined) throw new Error('the rewritten header has no period block');
    first[blockColumn(format.layout, 'periods', firstPeriod, 'label')] = firstLabel;
  }
  const grid: SheetData = [rewritten, first, ...rows.slice(1)];
  const layout = resolveLayout(format.layout, grid);
  if (layout === null) throw new Error('the rewritten header does not resolve');
  return createRowReader(format.layout, layout, grid[1] ?? [], READER_OPTIONS);
}

describe('commission tariff adapter: the week of the upload (inspect)', () => {
  // The 3+4 day file's first row fills only its 4-day period: 26 Haziran 08.00-30 Haziran 07.59.
  const now = new Date('2026-06-01T12:00:00.000Z');
  const weekStartsAt = new Date('2026-06-26T08:00:00.000Z');
  const weekEndsAt = new Date('2026-06-30T07:59:00.000Z');

  async function inspect(
    firstDataRow: Awaited<ReturnType<typeof firstDataRowOf>> | null,
    rows: readonly ImportedRow<CommissionTariffRow>[] = [],
  ) {
    return adapter.inspect({ scope: SCOPE, config: undefined, now, rows, firstDataRow });
  }

  /** A kept product row with the given current and commission base prices and commission. */
  function productRow(
    excelRow: number,
    currentPrice: string | null,
    commissionBasePrice: string | null,
    currentCommissionPct: string | null = '0',
  ): ImportedRow<CommissionTariffRow> {
    const barcode = `B-${excelRow}`;
    return {
      excelRow,
      anchor: barcode,
      data: {
        barcode,
        stockCode: null,
        productTitle: barcode,
        category: null,
        brand: null,
        stock: null,
        currentPrice,
        commissionBasePrice,
        currentCommissionPct,
        brackets: {
          band1Lower: '300',
          band2Lower: '200',
          band2Upper: '299.99',
          band3Lower: '100',
          band3Upper: '199.99',
          band4Upper: '99.99',
        },
        periodComms: [['19', '13.1', '12.1', '10.6']],
      },
    };
  }

  it("returns the week of the first row's periods when no tariff of the store overlaps it", async () => {
    mocks.findTariff.mockResolvedValue(null);

    const { week, unknownCurrentPriceRows, unknownCommissionRows } = await inspect(
      await firstDataRowOf(MULTI),
    );

    expect(unknownCurrentPriceRows).toBe(0);
    expect(unknownCommissionRows).toBe(0);
    expect(week.weekStartsAt).toEqual(weekStartsAt);
    expect(week.weekEndsAt).toEqual(weekEndsAt);
    expect(week.present.map((period) => [period.dayCount, period.layoutIndex])).toEqual([[4, 1]]);
    expect(mocks.findTariff).toHaveBeenCalledTimes(1);
    expect(mocks.findTariff).toHaveBeenCalledWith({
      where: {
        organizationId: SCOPE.organizationId,
        storeId: SCOPE.storeId,
        weekStartsAt: { lt: weekEndsAt },
        weekEndsAt: { gt: weekStartsAt },
      },
      select: { id: true },
    });
  });

  it('accepts the 7 day file: one period of a whole week', async () => {
    mocks.findTariff.mockResolvedValue(null);

    const { week } = await inspect(await firstDataRowOf(SINGLE));

    expect(week.present.map((period) => [period.dayCount, period.layoutIndex])).toEqual([[7, 0]]);
    expect(mocks.findTariff).toHaveBeenCalledTimes(1);
  });

  // Only a row with neither price has no current profit: a known commission base price
  // prices the current scenario even when the current price is unknown.
  it('counts the rows with neither a current price nor a commission base price', async () => {
    mocks.findTariff.mockResolvedValue(null);
    const rows = [
      productRow(2, null, null),
      productRow(3, null, '100'),
      productRow(4, '100', null),
      productRow(5, '100', '100'),
      productRow(6, null, null),
    ];

    const { unknownCurrentPriceRows } = await inspect(await firstDataRowOf(MULTI), rows);

    expect(unknownCurrentPriceRows).toBe(2);
  });

  // Only a null current commission is unknown: a readable 0 is a real 0%. The count does
  // not read the prices, and a row with no known price is not counted for that alone.
  it('counts a row with an unknown current commission', async () => {
    mocks.findTariff.mockResolvedValue(null);
    const rows = [
      productRow(2, '100', '100', null),
      productRow(3, '100', '100', '0'),
      productRow(4, '100', '100', '19'),
      productRow(5, null, null, null),
      productRow(6, null, null, '19'),
    ];

    const { unknownCommissionRows, unknownCurrentPriceRows } = await inspect(
      await firstDataRowOf(MULTI),
      rows,
    );

    expect(unknownCommissionRows).toBe(2);
    expect(unknownCurrentPriceRows).toBe(2);
  });

  it('refuses a week that overlaps a tariff of the store with DUPLICATE_WEEK', async () => {
    mocks.findTariff.mockResolvedValue({ id: 'tariff-1' });

    const err: unknown = await inspect(await firstDataRowOf(MULTI)).then(
      () => null,
      (rejection: unknown) => rejection,
    );

    expect(err).toBeInstanceOf(WorkbookFileRejection);
    if (!(err instanceof WorkbookFileRejection)) return;
    expect(err.code).toBe('DUPLICATE_WEEK');
  });

  it('refuses a sheet without a data row with NO_PERIOD, before any query', async () => {
    const err: unknown = await inspect(null).then(
      () => null,
      (rejection: unknown) => rejection,
    );

    expect(err).toBeInstanceOf(WorkbookFileRejection);
    if (!(err instanceof WorkbookFileRejection)) return;
    expect(err.code).toBe('NO_PERIOD');
    expect(mocks.findTariff).not.toHaveBeenCalled();
  });

  /** The rejection of an upload whose periods do not fit one Trendyol week (a 422 on `file`). */
  function expectPeriodsRefused(err: unknown): void {
    expect(err).toBeInstanceOf(SpreadsheetFileError);
    if (!(err instanceof SpreadsheetFileError)) return;
    expect(err.code).toBe('MALFORMED_SHEET');
    expect(err.meta).toEqual({ reason: TARIFF_PERIODS_REASON });
  }

  // A Trendyol week holds seven days, so a period of ten days, or periods that add up to
  // ten, are refused before the window labels are checked.
  it('refuses a period of 10 days, more days than a week holds, before any query', async () => {
    mocks.findTariff.mockResolvedValue(null);
    const firstDataRow = await firstDataRowWithDays(SINGLE, 7, 10);
    expect(firstDataRow.blocks('periods').map((period) => period.tag)).toEqual([10]);

    const err: unknown = await inspect(firstDataRow).then(
      () => null,
      (rejection: unknown) => rejection,
    );

    expectPeriodsRefused(err);
    expect(mocks.findTariff).not.toHaveBeenCalled();
  });

  it('refuses a split week of 3 and 7 days, more days than a week holds', async () => {
    mocks.findTariff.mockResolvedValue(null);
    const firstDataRow = await firstDataRowWithDays(
      MULTI,
      4,
      7,
      '23 Haziran 08.00-26 Haziran 07.59',
    );
    expect(firstDataRow.blocks('periods').map((period) => period.tag)).toEqual([3, 7]);
    expect(firstDataRow.blocks('periods').map((period) => period.text('label') !== null)).toEqual([
      true,
      true,
    ]);

    const err: unknown = await inspect(firstDataRow).then(
      () => null,
      (rejection: unknown) => rejection,
    );

    expectPeriodsRefused(err);
    expect(mocks.findTariff).not.toHaveBeenCalled();
  });

  it('refuses a split week of two 3-day periods, which the export cannot tell apart', async () => {
    mocks.findTariff.mockResolvedValue(null);
    const firstDataRow = await firstDataRowWithDays(
      MULTI,
      4,
      3,
      '23 Haziran 08.00-26 Haziran 07.59',
    );
    expect(firstDataRow.blocks('periods').map((period) => period.tag)).toEqual([3, 3]);

    const err: unknown = await inspect(firstDataRow).then(
      () => null,
      (rejection: unknown) => rejection,
    );

    expectPeriodsRefused(err);
    expect(mocks.findTariff).not.toHaveBeenCalled();
  });
});

describe('commission tariff adapter: form, name, response and the week index', () => {
  const week: TariffWeek = {
    present: [
      {
        label: '26 Haziran 08.00-30 Haziran 07.59',
        dayCount: 4,
        startsAt: null,
        endsAt: null,
        sortOrder: 0,
        layoutIndex: 1,
      },
    ],
    weekStartsAt: null,
    weekEndsAt: null,
  };

  it('reads the file and the optional name, with no other form field', () => {
    const file = new File([new Uint8Array(MULTI)], 'tariff.xlsx');

    expect(adapter.readForm({ file, name: 'Week 26' })).toEqual({
      file,
      name: 'Week 26',
      config: undefined,
    });
    expect(adapter.readForm({ file }).name).toBeUndefined();
  });

  it("falls back to the first present period's label for the name", () => {
    const counts = { unknownCurrentPriceRows: 0, unknownCommissionRows: 0 };
    expect(adapter.nameFallback({ week, ...counts })).toBe('26 Haziran 08.00-30 Haziran 07.59');
    expect(adapter.nameFallback({ week: { ...week, present: [] }, ...counts })).toBeNull();
  });

  it('answers the counts of the import, with the number of stored periods, unpriced rows and unknown commissions', () => {
    expect(
      adapter.toResponse({
        parentId: 'tariff-1',
        name: 'Week 26',
        itemCount: 55,
        rowCount: 55,
        distinctCount: 55,
        matchedRows: 1,
        matchedDistinct: 1,
        skippedRows: 0,
        prefilledRows: 7,
        meta: { week, unknownCurrentPriceRows: 3, unknownCommissionRows: 2 },
      }),
    ).toEqual({
      tariffId: 'tariff-1',
      productCount: 55,
      periodCount: 1,
      itemCount: 55,
      matched: 1,
      unmatched: 54,
      skippedRows: 0,
      prefilledRows: 7,
      unknownCurrentPriceRows: 3,
      unknownCommissionRows: 2,
    });
  });

  it('reads a unique violation on the week column as DUPLICATE_WEEK, and nothing else', () => {
    const violation = (fields: readonly string[]): unknown => ({
      code: 'P2002',
      meta: { driverAdapterError: { cause: { constraint: { fields } } } },
    });

    expect(adapter.rejectionForUniqueViolation(violation(['store_id', 'week_starts_at']))).toBe(
      'DUPLICATE_WEEK',
    );
    expect(adapter.rejectionForUniqueViolation(violation(['period_id', 'barcode']))).toBeNull();
    expect(adapter.rejectionForUniqueViolation(new Error('boom'))).toBeNull();
  });
});

describe('commission tariff adapter: importTariff outside the route', () => {
  it('refuses a store outside the organization with NotFoundError, before reading the file', async () => {
    mocks.findStore.mockResolvedValue(null);

    const err: unknown = await importTariff({
      organizationId: SCOPE.organizationId,
      storeId: SCOPE.storeId,
      file: MULTI,
      filename: 'tariff.xlsx',
      createdBy: null,
      now: new Date('2026-06-01T12:00:00.000Z'),
    }).then(
      () => null,
      (rejection: unknown) => rejection,
    );

    expect(err).toBeInstanceOf(NotFoundError);
    // The store is looked up by its id within the organization, never by id alone.
    expect(mocks.findStore).toHaveBeenCalledTimes(1);
    expect(mocks.findStore).toHaveBeenCalledWith({
      where: { id: SCOPE.storeId, organizationId: SCOPE.organizationId },
      select: { id: true, organizationId: true, platform: true },
    });
    expect(mocks.findTariff).not.toHaveBeenCalled();
  });
});
