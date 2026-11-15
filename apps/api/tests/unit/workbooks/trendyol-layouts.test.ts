import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  columnIndex,
  createRowReader,
  evaluate,
  normalizeHeader,
  readWorkbookGrid,
  resolveLayout,
  type BlockKey,
  type CellRow,
  type CellValue,
  type ColumnKey,
  type FlagRule,
  type LayoutSpec,
  type ResolvedBlock,
  type ResolvedLayout,
  type RowPredicate,
  type RowReader,
  type SheetData,
} from '@pazarsync/spreadsheet';
import { businessZoneEpochToInstant } from '@pazarsync/utils';
import { describe, expect, it, vi } from 'vitest';

import { parseAdvantageTariffRow } from '@/services/advantage-tariff-import.service';
import {
  resolveAdvantageTariffLayout,
  type AdvantageTariffLayout,
} from '@/services/advantage-tariff-layout';
import { parseCommissionTariffRow } from '@/services/commission-tariff-import.service';
import {
  FIXED_COLUMNS,
  resolveTariffLayout,
  type TariffLayout,
} from '@/services/commission-tariff-layout';
import { parsePlusTariffRow } from '@/services/plus-commission-tariff-import.service';
import {
  resolvePlusTariffLayout,
  type PlusTariffLayout,
} from '@/services/plus-commission-tariff-layout';
import {
  trendyolAdvantageTariffKeep,
  trendyolAdvantageTariffLayout,
} from '@/workbooks/formats/trendyol/advantage-tariff.layout';
import {
  trendyolCommissionTariffKeep,
  trendyolCommissionTariffLayout,
} from '@/workbooks/formats/trendyol/commission-tariff.layout';
import {
  trendyolPlusCommissionTariffKeep,
  trendyolPlusCommissionTariffLayout,
} from '@/workbooks/formats/trendyol/plus-commission-tariff.layout';

import {
  ADVANTAGE_DERIVED,
  COMMISSION_DERIVED,
  PLUS_CANCEL_NUMBER_ONE,
  PLUS_CANCEL_TEXT_ZERO,
  PLUS_DERIVED,
  type DerivedRow,
} from '../../helpers/workbook-derived-rows';

// Cross-validates the Trendyol layouts written as data against the hand-written
// resolvers and row parsers they are meant to replace, for every vertical whose legacy
// parser still exists (a vertical that moved onto the generic pipeline keeps its cases
// in its format test under tests/unit/workbooks/formats/):
//   - layout parity: resolveLayout, adapted to the legacy shape (an absent column is
//     -1 there, null here), deep-equals the legacy resolver on every fixture header row
//     and on every header array of the legacy layout tests (copied verbatim; those
//     files stay unchanged);
//   - keep parity: the layout's keep rule holds on exactly the rows the import keeps;
//   - row-reader parity: on every kept row, the typed row reader reads the same values
//     as the import service's row parser;
//   - derived rows: the real exports drop no row, so each vertical also runs the two
//     row parities on copies of its fixture's first kept row with some cells blanked or
//     rewritten, which puts the dropping side of every keep rule under test.

const FIXTURES_DIR = resolve(__dirname, '../../fixtures');
const READER_OPTIONS = { toInstant: businessZoneEpochToInstant };
/** The services' own fallback for a blank decimal cell. */
const SERVICE_ZERO = '0';
const VAR_FOLDED: FlagRule = { yes: 'var', compare: 'casefold-tr' };
const EVET_FOLDED: FlagRule = { yes: 'evet', compare: 'casefold-tr' };

// Sheet names, copied from the import services.
const COMMISSION_SHEET = 'KomisyonTarifeleriÜrünleri';
const PLUS_SHEET = 'TyPlusÜrünleri';
const ADVANTAGE_SHEET = 'YıldızlıÜrünEtiketleri';

// ─── Helpers ────────────────────────────────────────────────────────────────

const gridCache = new Map<string, Promise<SheetData>>();

// Fixtures are read through the parse worker. Its cold start alone went past vitest's
// 5 s default once under check:all load on the owner's machine, so this file waits
// longer; a real hang still fails.
const FIXTURE_TEST_TIMEOUT_MS = 60_000;
vi.setConfig({ testTimeout: FIXTURE_TEST_TIMEOUT_MS });

/** A fixture's grid, read once per file and sheet, the way the import service reads it. */
function readFixture(file: string, sheetName?: string): Promise<SheetData> {
  const key = `${file}#${sheetName ?? ''}`;
  const cached = gridCache.get(key);
  if (cached !== undefined) return cached;
  const buffer = readFileSync(resolve(FIXTURES_DIR, file));
  const grid = readWorkbookGrid(buffer, sheetName === undefined ? {} : { sheetName });
  gridCache.set(key, grid);
  return grid;
}

/** A grid whose only row is `header`. */
function headerGrid(header: readonly string[]): SheetData {
  return [[...header]];
}

/** The legacy resolvers spell an absent column as -1. */
function legacyIndex(index: number | null | undefined): number {
  return index ?? -1;
}

function present<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`${what} did not resolve`);
  return value;
}

function blocksOf<S extends LayoutSpec>(
  _spec: S,
  layout: ResolvedLayout,
  key: BlockKey<S>,
): readonly ResolvedBlock[] {
  return layout.blocks.get(key) ?? [];
}

/** A resolved block column; a missing key is a bug in this test's adapter. */
function blockColumn(block: ResolvedBlock, key: string): number {
  const index = block.columns.get(key);
  if (index === undefined) throw new Error(`Block column "${key}" was not resolved`);
  return index;
}

/** One vertical: the layout as data next to the legacy code it must reproduce. */
interface Vertical<S extends LayoutSpec, L, P> {
  readonly spec: S;
  readonly keep: RowPredicate<ColumnKey<S>>;
  readonly legacyResolve: (headerRow: CellRow) => L | null;
  /** Builds the legacy layout shape from the resolved layout. */
  readonly adapt: (layout: ResolvedLayout | null) => unknown;
  readonly legacyParse: (row: CellRow, layout: L) => P | null;
  /** The compared fields, as the service's row parser reads them. */
  readonly serviceFields: (parsed: P) => unknown;
  /** The same fields, read through the row reader. */
  readonly readerFields: (reader: RowReader<S>) => unknown;
}

function vertical<S extends LayoutSpec, L, P>(v: Vertical<S, L, P>): Vertical<S, L, P> {
  return v;
}

function expectLayoutParity<S extends LayoutSpec, L, P>(
  v: Vertical<S, L, P>,
  grid: SheetData,
): void {
  expect(v.adapt(resolveLayout(v.spec, grid))).toEqual(v.legacyResolve(grid[0] ?? []));
}

/** Asserts the keep parity; returns, per data row, whether the import keeps it. */
function expectKeepParity<S extends LayoutSpec, L, P>(
  v: Vertical<S, L, P>,
  grid: SheetData,
): readonly boolean[] {
  const layout = present(resolveLayout(v.spec, grid), 'layout');
  const legacy = present(v.legacyResolve(grid[0] ?? []), 'legacy layout');
  const rows = grid.slice(1);
  const kept = rows.map((row) => evaluate(v.keep, row, v.spec, layout));
  const serviceKept = rows.map((row) => v.legacyParse(row, legacy) !== null);
  expect(kept).toEqual(serviceKept);
  // The import keeps rows of this fixture, so the row-reader parity is not vacuous.
  expect(serviceKept).toContain(true);
  return serviceKept;
}

function expectReaderParity<S extends LayoutSpec, L, P>(
  v: Vertical<S, L, P>,
  grid: SheetData,
): void {
  const layout = present(resolveLayout(v.spec, grid), 'layout');
  const legacy = present(v.legacyResolve(grid[0] ?? []), 'legacy layout');
  const fromReader: unknown[] = [];
  const fromService: unknown[] = [];
  for (const row of grid.slice(1)) {
    const parsed = v.legacyParse(row, legacy);
    if (parsed === null) continue;
    fromService.push(v.serviceFields(parsed));
    fromReader.push(v.readerFields(createRowReader(v.spec, layout, row, READER_OPTIONS)));
  }
  expect(fromService.length).toBeGreaterThan(0);
  expect(fromReader).toEqual(fromService);
}

interface HeaderCase {
  readonly name: string;
  readonly header: readonly string[];
  /** Whether the legacy resolver accepts the header, so a null-equals-null pass is not silent. */
  readonly resolves: boolean;
}

function expectHeaderParity<S extends LayoutSpec, L, P>(
  v: Vertical<S, L, P>,
  testCase: HeaderCase,
): void {
  expectLayoutParity(v, headerGrid(testCase.header));
  expect(v.legacyResolve(testCase.header) !== null).toBe(testCase.resolves);
}

/** The three fixture parities of one vertical on one fixture file. */
function describeFixture<S extends LayoutSpec, L, P>(
  v: Vertical<S, L, P>,
  file: string,
  sheetName?: string,
): void {
  describe(`fixture ${file}`, () => {
    it('resolves like the legacy resolver', async () => {
      expectLayoutParity(v, await readFixture(file, sheetName));
    });

    it('keeps exactly the rows the import keeps', async () => {
      expectKeepParity(v, await readFixture(file, sheetName));
    });

    it('reads the same fields as the import row parser', async () => {
      expectReaderParity(v, await readFixture(file, sheetName));
    });
  });
}

function describeHeaders<S extends LayoutSpec, L, P>(
  v: Vertical<S, L, P>,
  cases: readonly HeaderCase[],
): void {
  it.each(cases)('resolves the $name like the legacy resolver', (testCase) => {
    expectHeaderParity(v, testCase);
  });
}

/** The first data row of `grid` that the import keeps. */
function firstKeptRow<S extends LayoutSpec, L, P>(
  v: Vertical<S, L, P>,
  grid: SheetData,
): readonly CellValue[] {
  const legacy = present(v.legacyResolve(grid[0] ?? []), 'legacy layout');
  const row = grid.slice(1).find((candidate) => v.legacyParse(candidate, legacy) !== null);
  if (row === undefined) throw new Error('The fixture has no kept row');
  return row;
}

/** A copy of the fixture's first kept row with the cells of `derived` written over it. */
function deriveRow<S extends LayoutSpec, L, P>(
  v: Vertical<S, L, P>,
  grid: SheetData,
  derived: DerivedRow<S>,
): CellValue[] {
  const layout = present(resolveLayout(v.spec, grid), 'layout');
  const row = [...firstKeptRow(v, grid)];
  for (const [key, value] of derived.cells) {
    row[present(columnIndex(v.spec, layout, key), `column ${key}`)] = value;
  }
  return row;
}

/**
 * The two row parities on rows derived from a fixture's first kept row: each case
 * appended to the fixture on its own, then all of them at once, where the import must
 * drop at least one row.
 */
function describeDerivedRows<S extends LayoutSpec, L, P>(
  v: Vertical<S, L, P>,
  cases: readonly DerivedRow<S>[],
  file: string,
  sheetName?: string,
): void {
  describe(`rows derived from the first kept row of ${file}`, () => {
    it.each(cases)('keeps the row with $name exactly when the import does', async (derived) => {
      const fixture = await readFixture(file, sheetName);
      const grid = [...fixture, deriveRow(v, fixture, derived)];
      expect(expectKeepParity(v, grid).at(-1)).toBe(derived.kept);
      expectReaderParity(v, grid);
    });

    it('drops at least one row once all the derived rows join the fixture', async () => {
      const fixture = await readFixture(file, sheetName);
      const grid = [...fixture, ...cases.map((derived) => deriveRow(v, fixture, derived))];
      expect(expectKeepParity(v, grid)).toContain(false);
      expectReaderParity(v, grid);
    });
  });
}

// ─── Commission tariff ──────────────────────────────────────────────────────

type LegacyCommissionShape = Omit<TariffLayout, 'fixed'> & {
  readonly fixed: Readonly<Record<keyof typeof FIXED_COLUMNS, number>>;
};

function adaptCommission(resolved: ResolvedLayout | null): LegacyCommissionShape | null {
  if (resolved === null) return null;
  const spec = trendyolCommissionTariffLayout;
  const col = (key: ColumnKey<typeof spec>): number =>
    legacyIndex(columnIndex(spec, resolved, key));
  return {
    fixed: {
      productTitle: col('productTitle'),
      barcode: col('barcode'),
      sellerStockCode: col('sellerStockCode'),
      size: col('size'),
      modelCode: col('modelCode'),
      category: col('category'),
      brand: col('brand'),
      stock: col('stock'),
      band1Lower: col('band1Lower'),
      band2Upper: col('band2Upper'),
      band2Lower: col('band2Lower'),
      band3Upper: col('band3Upper'),
      band3Lower: col('band3Lower'),
      band4Upper: col('band4Upper'),
    },
    currentPrice: col('currentPrice'),
    commissionBasePrice: col('commissionBasePrice'),
    currentCommission: col('currentCommission'),
    newTsf: col('newTsf'),
    tariffSelection: col('tariffSelection'),
    periods: blocksOf(spec, resolved, 'periods').map((block) => ({
      dayCount: block.tag,
      labelCol: blockColumn(block, 'label'),
      commCols: [
        blockColumn(block, 'comm1'),
        blockColumn(block, 'comm2'),
        blockColumn(block, 'comm3'),
        blockColumn(block, 'comm4'),
      ],
    })),
  };
}

const COMMISSION = vertical({
  spec: trendyolCommissionTariffLayout,
  keep: trendyolCommissionTariffKeep,
  legacyResolve: resolveTariffLayout,
  adapt: adaptCommission,
  legacyParse: parseCommissionTariffRow,
  serviceFields: (parsed) => ({
    barcode: parsed.barcode,
    currentPrice: parsed.currentPrice,
    periodComms: parsed.periodComms,
  }),
  readerFields: (reader) => ({
    barcode: reader.text('barcode'),
    currentPrice: reader.decimal('currentPrice') ?? SERVICE_ZERO,
    periodComms: reader
      .blocks('periods')
      .map((period) => [
        period.decimal('comm1'),
        period.decimal('comm2'),
        period.decimal('comm3'),
        period.decimal('comm4'),
      ]),
  }),
});

// Copied verbatim from tests/unit/commission-tariff-layout.test.ts.
const COMMISSION_FIXED: readonly string[] = [
  'ÜRÜN İSMİ',
  'BARKOD',
  'SATICI STOK KODU',
  'BEDEN',
  'MODEL KODU',
  'KATEGORİ',
  'MARKA',
  'STOK',
  '1.Fiyat Alt Limit',
  '2.Fiyat Üst Limiti',
  '2.Fiyat Alt Limit',
  '3.Fiyat Üst Limiti',
  '3.Fiyat Alt Limit',
  '4.Fiyat Üst Limiti',
];

const COMMISSION_COMMS: readonly string[] = [
  '1.KOMİSYON',
  '2.KOMİSYON',
  '3.KOMİSYON',
  '4.KOMİSYON',
];

const COMMISSION_HEADERS: readonly HeaderCase[] = [
  {
    name: 'two-period header',
    header: [
      ...COMMISSION_FIXED,
      'Tarih aralığı (3 Gün)',
      ...COMMISSION_COMMS,
      'Tarih aralığı (4 Gün)',
      ...COMMISSION_COMMS,
      'KOMİSYONA ESAS FİYAT',
      'GÜNCEL KOMİSYON',
      'GÜNCEL TSF',
      'YENİ TSF (FİYAT GÜNCELLE)',
      'Hesaplanan Komisyon (3 Gün)',
      'Hesaplanan Komisyon (4 Gün)',
      'Tarife Seçimi',
      'FIRST EXTERNAL ID',
      'SECOND EXTERNAL ID',
      'FULL EXTERNAL ID',
      'TARİFE GRUBU',
    ],
    resolves: true,
  },
  {
    name: 'one-period header',
    header: [
      ...COMMISSION_FIXED,
      'Tarih aralığı (7 Gün)',
      ...COMMISSION_COMMS,
      'KOMİSYONA ESAS FİYAT',
      'GÜNCEL KOMİSYON',
      'GÜNCEL TSF',
      'YENİ TSF (FİYAT GÜNCELLE)',
      'Hesaplanan Komisyon (7 Gün)',
      'Tarife Seçimi',
      'EXTERNAL ID',
      'TARİFE GRUBU',
    ],
    resolves: true,
  },
  { name: 'non-tariff header', header: ['not', 'a', 'tariff', 'header'], resolves: false },
  {
    name: 'header without a period block',
    header: [...COMMISSION_FIXED, 'GÜNCEL TSF', 'YENİ TSF (FİYAT GÜNCELLE)', 'Tarife Seçimi'],
    resolves: false,
  },
  {
    name: 'header missing a tail column',
    header: [...COMMISSION_FIXED, 'Tarih aralığı (4 Gün)', ...COMMISSION_COMMS, 'GÜNCEL TSF'],
    resolves: false,
  },
];

const COMMISSION_FILE = 'trendyol-commission-tariff.xlsx';

describe('Trendyol commission tariff layout', () => {
  describeFixture(COMMISSION, COMMISSION_FILE, COMMISSION_SHEET);
  describeFixture(COMMISSION, 'trendyol-tariff-1period.xlsx', COMMISSION_SHEET);
  describeHeaders(COMMISSION, COMMISSION_HEADERS);
  describeDerivedRows(COMMISSION, COMMISSION_DERIVED, COMMISSION_FILE, COMMISSION_SHEET);

  it('resolves both blocks of the 3+4 day fixture, the empty 3-day block included', async () => {
    const grid = await readFixture('trendyol-commission-tariff.xlsx', COMMISSION_SHEET);
    const resolved = present(resolveLayout(trendyolCommissionTariffLayout, grid), 'layout');
    const tags = blocksOf(trendyolCommissionTariffLayout, resolved, 'periods').map(
      (block) => block.tag,
    );
    expect(tags).toEqual([3, 4]);
  });
});

// ─── Plus commission tariff ─────────────────────────────────────────────────

function adaptPlus(resolved: ResolvedLayout | null): PlusTariffLayout | null {
  if (resolved === null) return null;
  const spec = trendyolPlusCommissionTariffLayout;
  const col = (key: ColumnKey<typeof spec>): number =>
    legacyIndex(columnIndex(spec, resolved, key));
  return {
    productTitle: col('productTitle'),
    barcode: col('barcode'),
    sellerStockCode: col('sellerStockCode'),
    size: col('size'),
    modelCode: col('modelCode'),
    category: col('category'),
    brand: col('brand'),
    stock: col('stock'),
    currentPrice: col('currentPrice'),
    commissionBasePrice: col('commissionBasePrice'),
    currentCommission: col('currentCommission'),
    plusPriceUpperLimit: col('plusPriceUpperLimit'),
    plusCommissionBasePrice: col('plusCommissionBasePrice'),
    externalId: col('externalId'),
    tariffGroup: col('tariffGroup'),
    cancelled: col('cancelled'),
    plusPriceSelection: col('plusPriceSelection'),
    tariffSelection: col('tariffSelection'),
    periods: blocksOf(spec, resolved, 'periods').map((block) => ({
      dayCount: block.tag,
      labelCol: blockColumn(block, 'label'),
      offerCol: blockColumn(block, 'offer'),
      computedCommissionCol: legacyIndex(block.lookups.get('computedCommission')),
    })),
  };
}

const PLUS = vertical({
  spec: trendyolPlusCommissionTariffLayout,
  keep: trendyolPlusCommissionTariffKeep,
  legacyResolve: resolvePlusTariffLayout,
  adapt: adaptPlus,
  legacyParse: parsePlusTariffRow,
  serviceFields: (parsed) => ({
    barcode: parsed.barcode,
    cancelled: parsed.cancelled,
    periodOffers: parsed.periodOffers,
  }),
  readerFields: (reader) => ({
    barcode: reader.text('barcode'),
    cancelled: reader.numericFlag('cancelled'),
    periodOffers: reader.blocks('periods').map((period) => period.decimal('offer') ?? SERVICE_ZERO),
  }),
});

// Copied verbatim from tests/unit/plus-commission-tariff-layout.test.ts.
const PLUS_HEADER: readonly string[] = [
  'Ürün İsmi',
  'Ürün Id',
  'Barkod',
  'Satıcı Stok Kodu',
  'Beden',
  'Model Kodu',
  'Kategori',
  'Marka',
  'Stok',
  'Güncel TSF',
  'Komisyona Esas Fiyat',
  'Güncel Komisyon',
  'Plus Fiyat Üst Limiti',
  'Tarih Aralığı (7 Gün)',
  'Plus Komisyon Teklifi',
  'Plus Komisyona Esas Fiyatı',
  'Plus Fiyat Seçimi',
  'Tarife Seçimi',
  'Hesaplanan Komisyon (7 Gün)',
  'İptal',
  'External Id',
  'Tarife Grubu',
];

const PLUS_HEADER_MULTI: readonly string[] = [
  'Ürün İsmi',
  'Ürün Id',
  'Barkod',
  'Satıcı Stok Kodu',
  'Beden',
  'Model Kodu',
  'Kategori',
  'Marka',
  'Stok',
  'Güncel TSF',
  'Komisyona Esas Fiyat',
  'Güncel Komisyon',
  'Plus Fiyat Üst Limiti',
  'Tarih Aralığı (3 Gün)',
  'Plus Komisyon Teklifi',
  'Tarih Aralığı (4 Gün)',
  'Plus Komisyon Teklifi',
  'Plus Komisyona Esas Fiyatı',
  'Plus Fiyat Seçimi',
  'Tarife Seçimi',
  'External Id',
  'Hesaplanan Komisyon (3 Gün)',
  'Hesaplanan Komisyon (4 Gün)',
  'İptal',
  'Tarife Grubu',
  '3 Gün Tarih Aralığı',
  '4 Gün Tarih Aralığı',
  '7 Gün Tarih Aralığı',
  'External Id (3 Gün)',
  'External Id (4 Gün)',
  'External Id (7 Gün)',
];

const PLUS_HEADERS: readonly HeaderCase[] = [
  { name: 'single-period header', header: PLUS_HEADER, resolves: true },
  { name: 'two-period header with decoys', header: PLUS_HEADER_MULTI, resolves: true },
  {
    name: 'header without computed-commission columns',
    header: PLUS_HEADER.filter((h) => !h.startsWith('Hesaplanan Komisyon')),
    resolves: true,
  },
  {
    name: 'header with the lower-case period spelling',
    header: PLUS_HEADER.map((h) => (h === 'Tarih Aralığı (7 Gün)' ? 'Tarih aralığı (7 Gün)' : h)),
    resolves: true,
  },
  {
    name: 'header whose period is not followed by the offer column',
    header: PLUS_HEADER.map((h) => (h === 'Plus Komisyon Teklifi' ? 'Bir Başka Kolon' : h)),
    resolves: false,
  },
  {
    name: 'header without a period',
    header: PLUS_HEADER.filter((h) => !h.startsWith('Tarih')),
    resolves: false,
  },
  {
    name: 'header missing Barkod',
    header: PLUS_HEADER.filter((h) => h !== 'Barkod'),
    resolves: false,
  },
  { name: 'non-Plus header', header: ['not', 'a', 'plus', 'header'], resolves: false },
];

const PLUS_FILE = 'trendyol-plus-tariff.xlsx';

describe('Trendyol Plus commission tariff layout', () => {
  describeFixture(PLUS, PLUS_FILE, PLUS_SHEET);
  describeFixture(PLUS, 'trendyol-plus-tariff-3ve4.xlsx', PLUS_SHEET);
  describeHeaders(PLUS, PLUS_HEADERS);
  describeDerivedRows(PLUS, PLUS_DERIVED, PLUS_FILE, PLUS_SHEET);

  it('reads the cancel cell like the import: the number 1 cancels, the text "0" does not', async () => {
    const grid = await readFixture(PLUS_FILE, PLUS_SHEET);
    const spec = trendyolPlusCommissionTariffLayout;
    const layout = present(resolveLayout(spec, grid), 'layout');
    const legacy = present(resolvePlusTariffLayout(grid[0] ?? []), 'legacy layout');
    const cancelled = (derived: DerivedRow<typeof spec>): unknown => {
      const row = deriveRow(PLUS, grid, derived);
      return {
        service: parsePlusTariffRow(row, legacy)?.cancelled,
        reader: createRowReader(spec, layout, row, READER_OPTIONS).numericFlag('cancelled'),
      };
    };
    expect(cancelled(PLUS_CANCEL_NUMBER_ONE)).toEqual({ service: true, reader: true });
    expect(cancelled(PLUS_CANCEL_TEXT_ZERO)).toEqual({ service: false, reader: false });
  });
});

// ─── Advantage tariff ───────────────────────────────────────────────────────

function adaptAdvantage(resolved: ResolvedLayout | null): AdvantageTariffLayout | null {
  if (resolved === null) return null;
  const spec = trendyolAdvantageTariffLayout;
  const col = (key: ColumnKey<typeof spec>): number =>
    legacyIndex(columnIndex(spec, resolved, key));
  return {
    productTitle: col('productTitle'),
    barcode: col('barcode'),
    size: col('size'),
    modelCode: col('modelCode'),
    category: col('category'),
    brand: col('brand'),
    stock: col('stock'),
    commissionTariffFlag: col('commissionTariffFlag'),
    tier1Upper: col('tier1Upper'),
    tier1Lower: col('tier1Lower'),
    tier2Upper: col('tier2Upper'),
    tier2Lower: col('tier2Lower'),
    tier3Upper: col('tier3Upper'),
    customerPrice: col('customerPrice'),
    currentPrice: col('currentPrice'),
    newTsf: col('newTsf'),
    applyUntilEnd: col('applyUntilEnd'),
    externalId: col('externalId'),
    tariffGroup: col('tariffGroup'),
  };
}

const ADVANTAGE = vertical({
  spec: trendyolAdvantageTariffLayout,
  keep: trendyolAdvantageTariffKeep,
  legacyResolve: resolveAdvantageTariffLayout,
  adapt: adaptAdvantage,
  legacyParse: parseAdvantageTariffRow,
  serviceFields: (parsed) => ({
    barcode: parsed.barcode,
    currentPrice: parsed.currentPrice,
    hasCommissionTariff: parsed.hasCommissionTariff,
    applyUntilEnd: parsed.applyUntilEnd,
  }),
  readerFields: (reader) => ({
    barcode: reader.text('barcode'),
    currentPrice: reader.decimal('currentPrice'),
    hasCommissionTariff: reader.flag('commissionTariffFlag', VAR_FOLDED),
    applyUntilEnd: reader.flag('applyUntilEnd', EVET_FOLDED),
  }),
});

const ADVANTAGE_FILE = 'trendyol-advantage-tariff.xlsx';

// Copied verbatim from tests/unit/advantage-tariff-layout.test.ts.
const ADVANTAGE_HEADER: readonly string[] = [
  'ÜRÜN İSMİ',
  'BARKOD',
  'BEDEN',
  'MODEL KODU',
  'KATEGORİ',
  'MARKA',
  'STOK',
  'KOMİSYON TARİFESİ',
  '1 YILDIZ ÜST FİYAT',
  '1 YILDIZ ALT FİYAT',
  '2 YILDIZ ÜST FİYAT',
  '2 YILDIZ ALT FİYAT',
  '3 YILDIZ ÜST FİYAT',
  'MÜŞTERİNİN GÖRDÜĞÜ FİYAT',
  'TRENDYOL SATIŞ FİYATI',
  'YENİ TSF (FİYAT GÜNCELLE)',
  'Tarife Sonuna Kadar Uygula',
  'EXTERNAL ID',
  'TARİFE GRUBU',
];

const ADVANTAGE_HEADERS: readonly HeaderCase[] = [
  { name: 'real header', header: ADVANTAGE_HEADER, resolves: true },
  {
    name: 'header missing BARKOD',
    header: ADVANTAGE_HEADER.filter((h) => h !== 'BARKOD'),
    resolves: false,
  },
  {
    name: 'header missing a star threshold',
    header: ADVANTAGE_HEADER.filter((h) => h !== '3 YILDIZ ÜST FİYAT'),
    resolves: false,
  },
  { name: 'non-Advantage header', header: ['not', 'an', 'advantage', 'header'], resolves: false },
];

describe('Trendyol advantage tariff layout', () => {
  describeFixture(ADVANTAGE, ADVANTAGE_FILE, ADVANTAGE_SHEET);
  describeHeaders(ADVANTAGE, ADVANTAGE_HEADERS);
  describeDerivedRows(ADVANTAGE, ADVANTAGE_DERIVED, ADVANTAGE_FILE, ADVANTAGE_SHEET);

  it('reads the same fields when the optional apply-until-end flag column is absent', async () => {
    const grid = await readFixture(ADVANTAGE_FILE, ADVANTAGE_SHEET);
    const dropAt = (grid[0] ?? []).findIndex(
      (cell) => normalizeHeader(cell) === 'Tarife Sonuna Kadar Uygula',
    );
    expect(dropAt).toBeGreaterThanOrEqual(0);
    const withoutFlag = grid.map((row) => row.filter((_, index) => index !== dropAt));
    expectReaderParity(ADVANTAGE, withoutFlag);
  });

  it('does not keep a row with a barcode but no current price', () => {
    const layout = present(
      resolveLayout(trendyolAdvantageTariffLayout, headerGrid(ADVANTAGE_HEADER)),
      'layout',
    );
    const legacy = present(resolveAdvantageTariffLayout(ADVANTAGE_HEADER), 'legacy layout');
    const withoutPrice = ADVANTAGE_HEADER.map((h) => (h === 'BARKOD' ? '8690000000001' : null));
    const withPrice = ADVANTAGE_HEADER.map((h) => {
      if (h === 'BARKOD') return '8690000000001';
      return h === 'TRENDYOL SATIŞ FİYATI' ? 250 : null;
    });

    expect(
      evaluate(trendyolAdvantageTariffKeep, withoutPrice, trendyolAdvantageTariffLayout, layout),
    ).toBe(false);
    expect(parseAdvantageTariffRow(withoutPrice, legacy)).toBeNull();
    expect(
      evaluate(trendyolAdvantageTariffKeep, withPrice, trendyolAdvantageTariffLayout, layout),
    ).toBe(true);
    expect(parseAdvantageTariffRow(withPrice, legacy)).not.toBeNull();
  });
});
