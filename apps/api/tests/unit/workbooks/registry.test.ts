// The composition root of the workbook pipeline: every page has one adapter and its
// formats, and every format's default list name is the one a seller sees.

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Platform } from '@pazarsync/db/enums';
import { readWorkbookGrid, type SheetSelector } from '@pazarsync/spreadsheet';
import {
  UPLOAD_NAME_MAX_LENGTH,
  WORKBOOK_PAGE_PLATFORMS,
  WORKBOOK_PAGES,
  type WorkbookPage,
} from '@pazarsync/utils';
import { describe, expect, it, vi } from 'vitest';

import { trendyolAdvantageTariffFormat } from '@/workbooks/formats/trendyol/advantage-tariff.format';
import { trendyolCommissionTariffFormat } from '@/workbooks/formats/trendyol/commission-tariff.format';
import { trendyolDiscountListFormat } from '@/workbooks/formats/trendyol/discount-list.format';
import { trendyolFlashProductListFormat } from '@/workbooks/formats/trendyol/flash-product-list.format';
import { trendyolMarketplaceCampaignListFormat } from '@/workbooks/formats/trendyol/marketplace-campaign-list.format';
import { trendyolPlusCommissionTariffFormat } from '@/workbooks/formats/trendyol/plus-commission-tariff.format';
import { cleanDisplayName } from '@/workbooks/form';
import { SOURCE_FORMAT_ID_MAX_LENGTH } from '@/config/workbook-limits';
import { FORMAT_SUMMARIES, type FormatSummary } from '@/workbooks/formats/registry';
import { diagnoseWorkbook } from '@/workbooks/select-format';
import { WORKBOOK_PARENT_TABLES, type WorkbookParentTable } from '@/workbooks/upload-quota';
import { advantageTariffAdapter } from '@/workbooks/verticals/advantage-tariff.adapter';
import { commissionTariffAdapter } from '@/workbooks/verticals/commission-tariff.adapter';
import { discountListAdapter } from '@/workbooks/verticals/discount-list.adapter';
import { flashProductListAdapter } from '@/workbooks/verticals/flash-product-list.adapter';
import { marketplaceCampaignListAdapter } from '@/workbooks/verticals/marketplace-campaign-list.adapter';
import { plusCommissionTariffAdapter } from '@/workbooks/verticals/plus-commission-tariff.adapter';

import {
  readMigrationSql,
  SOURCE_FORMAT_MIGRATIONS,
  sourceFormatBackfills,
} from '../../helpers/workbook-migrations';

/** Builds text from code points, so this file stays ASCII and owes nothing to labels.ts. */
function fromCodePoints(...parts: readonly (string | number)[]): string {
  return parts
    .map((part) => (typeof part === 'number' ? String.fromCodePoint(part) : part))
    .join('');
}

const LOWER_DOTLESS_I = 0x131;
const UPPER_U_UMLAUT = 0xdc;
const LOWER_U_UMLAUT = 0xfc;
const LOWER_S_CEDILLA = 0x15f;
const UPPER_DOTTED_I = 0x130;

/**
 * The default list name of each page, written independently of labels.ts: a name
 * corrupted on its way into the source (a mangled multi-byte character) fails here
 * instead of reaching a seller's screen.
 */
const EXPECTED_DEFAULT_NAMES: Readonly<Record<WorkbookPage, string>> = {
  COMMISSION_TARIFF: 'Komisyon Tarifesi',
  PLUS_COMMISSION_TARIFF: 'Plus Komisyon Tarifesi',
  ADVANTAGE_TARIFF: fromCodePoints(
    'Avantajl',
    LOWER_DOTLESS_I,
    ' ',
    UPPER_U_UMLAUT,
    'r',
    LOWER_U_UMLAUT,
    'n Etiketleri',
  ),
  FLASH_PRODUCT_LIST: fromCodePoints(
    'Fla',
    LOWER_S_CEDILLA,
    ' ',
    UPPER_U_UMLAUT,
    'r',
    LOWER_U_UMLAUT,
    'nler',
  ),
  DISCOUNT_LIST: fromCodePoints(UPPER_DOTTED_I, 'ndirim Listesi'),
  MARKETPLACE_CAMPAIGN_LIST: 'Kampanya',
};

const TRENDYOL_FORMATS = [
  trendyolCommissionTariffFormat,
  trendyolPlusCommissionTariffFormat,
  trendyolAdvantageTariffFormat,
  trendyolFlashProductListFormat,
  trendyolDiscountListFormat,
  trendyolMarketplaceCampaignListFormat,
] as const;

describe('default list names', () => {
  it.each(Object.values(WORKBOOK_PAGES))(
    '%s: the format names a new list as the seller reads it',
    (page) => {
      const formats = TRENDYOL_FORMATS.filter((format) => format.page === page);
      expect(formats).toHaveLength(1);
      const [format] = formats;
      expect(format?.defaultName).toBe(EXPECTED_DEFAULT_NAMES[page]);
      // The stored name of a list with no typed name and no file name stem is the cleaned
      // default name: cleaning must leave it unchanged.
      expect(cleanDisplayName(EXPECTED_DEFAULT_NAMES[page], UPLOAD_NAME_MAX_LENGTH)).toBe(
        EXPECTED_DEFAULT_NAMES[page],
      );
    },
  );
});

// The real files are read through the parse worker, whose cold start can pass vitest's
// 5 s default under load.
vi.setConfig({ testTimeout: 60_000 });

/** What this file reads of an adapter: where it is wired, not how it behaves. */
interface AdapterFacts {
  readonly page: WorkbookPage;
  readonly parentTable: WorkbookParentTable;
  readonly formats: readonly FormatSummary[];
}

/** The six adapters the route modules mount, one per page. */
const ADAPTERS: readonly AdapterFacts[] = [
  commissionTariffAdapter,
  plusCommissionTariffAdapter,
  advantageTariffAdapter,
  flashProductListAdapter,
  discountListAdapter,
  marketplaceCampaignListAdapter,
];

const ADAPTER_FORMATS: readonly FormatSummary[] = ADAPTERS.flatMap((adapter) => adapter.formats);

/** The format id the backfills write: the Trendyol format of the first version. */
const BACKFILLED_FORMAT_VERSION_SUFFIX = ':v1';

/** The workbook's first sheet: the header row a wrong-page upload is diagnosed from. */
const FIRST_SHEET: SheetSelector = { by: 'index', index: 0 };

const FIXTURES_DIR = resolve(__dirname, '../../fixtures');

/** Every real marketplace file under tests/fixtures, with the page it belongs to. */
const FIXTURE_PAGES: Readonly<Record<string, WorkbookPage>> = {
  'marketplace-campaign-sample.xlsx': WORKBOOK_PAGES.MARKETPLACE_CAMPAIGN_LIST,
  'trendyol-advantage-tariff.xlsx': WORKBOOK_PAGES.ADVANTAGE_TARIFF,
  'trendyol-commission-tariff.xlsx': WORKBOOK_PAGES.COMMISSION_TARIFF,
  'trendyol-discount-products.xlsx': WORKBOOK_PAGES.DISCOUNT_LIST,
  'trendyol-flash-products.xlsx': WORKBOOK_PAGES.FLASH_PRODUCT_LIST,
  'trendyol-plus-tariff-3ve4.xlsx': WORKBOOK_PAGES.PLUS_COMMISSION_TARIFF,
  'trendyol-plus-tariff.xlsx': WORKBOOK_PAGES.PLUS_COMMISSION_TARIFF,
  'trendyol-tariff-1period.xlsx': WORKBOOK_PAGES.COMMISSION_TARIFF,
};

function adapterOf(page: WorkbookPage): AdapterFacts {
  const adapter = ADAPTERS.find((candidate) => candidate.page === page);
  if (adapter === undefined) throw new Error(`no adapter for ${page}`);
  return adapter;
}

/** The adapter's one Trendyol format of the first version: the id a backfill must write. */
function backfilledFormatId(adapter: AdapterFacts): string {
  const formats = adapter.formats.filter(
    (format) =>
      format.platform === Platform.TRENDYOL && format.id.endsWith(BACKFILLED_FORMAT_VERSION_SUFFIX),
  );
  expect(formats).toHaveLength(1);
  const [format] = formats;
  if (format === undefined) throw new Error(`no Trendyol v1 format for ${adapter.page}`);
  return format.id;
}

describe('composition root', () => {
  it('has one adapter per page', () => {
    expect(ADAPTERS).toHaveLength(Object.values(WORKBOOK_PAGES).length);
  });

  it.each(Object.values(WORKBOOK_PAGES))(
    '%s: exactly one adapter, its formats of its page, at least one of them Trendyol',
    (page) => {
      const adapters = ADAPTERS.filter((adapter) => adapter.page === page);
      expect(adapters).toHaveLength(1);
      const [adapter] = adapters;
      if (adapter === undefined) throw new Error(`no adapter for ${page}`);
      expect(adapter.formats.map((format) => format.page)).toEqual(adapter.formats.map(() => page));
      expect(
        adapter.formats.filter((format) => format.platform === Platform.TRENDYOL).length,
      ).toBeGreaterThanOrEqual(1);
    },
  );

  it('gives every format a unique id of the form PLATFORM:PAGE:v<n>', () => {
    const ids = ADAPTER_FORMATS.map((format) => format.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const format of ADAPTER_FORMATS) {
      expect(format.id).toMatch(new RegExp(`^${format.platform}:${format.page}:v[1-9][0-9]*$`));
    }
  });

  it('uses every format summary in exactly one adapter format, with the same values', () => {
    for (const summary of FORMAT_SUMMARIES) {
      const formats = ADAPTER_FORMATS.filter((format) => format.id === summary.id);
      expect(formats).toHaveLength(1);
      const [format] = formats;
      if (format === undefined) throw new Error(`no adapter format for ${summary.id}`);
      expect(format.platform).toBe(summary.platform);
      expect(format.page).toBe(summary.page);
      // The same array: a format takes its fingerprint from its summary, never a copy.
      expect(format.fingerprint).toBe(summary.fingerprint);
    }
  });

  it('has a summary for every adapter format', () => {
    for (const format of ADAPTER_FORMATS) {
      expect(FORMAT_SUMMARIES.filter((summary) => summary.id === format.id)).toHaveLength(1);
    }
  });

  it('registers no Hepsiburada format', () => {
    expect(ADAPTER_FORMATS.filter((format) => format.platform === Platform.HEPSIBURADA)).toEqual(
      [],
    );
    expect(FORMAT_SUMMARIES.filter((summary) => summary.platform === Platform.HEPSIBURADA)).toEqual(
      [],
    );
  });

  it('gives each adapter its own parent table from WORKBOOK_PARENT_TABLES', () => {
    const tables = ADAPTERS.map((adapter) => adapter.parentTable);
    expect(new Set(tables).size).toBe(tables.length);
    for (const table of tables) {
      expect(WORKBOOK_PARENT_TABLES).toContain(table);
    }
  });
});

describe('WORKBOOK_PAGE_PLATFORMS', () => {
  it('lists, for every page, exactly the platforms the registry has a format for', () => {
    // @pazarsync/utils cannot import the registry, so its copy is pinned here (same
    // pattern as the WORKBOOK_ENGINE_FILE_CODES pin in workbook-errors.test.ts).
    // Every page starts from an empty list, so a page with no format shows up as [].
    const fromRegistry = Object.fromEntries(
      Object.values(WORKBOOK_PAGES).map((page) => [
        page,
        [
          ...new Set(
            FORMAT_SUMMARIES.filter((summary) => summary.page === page).map(
              (summary) => summary.platform,
            ),
          ),
        ].sort(),
      ]),
    );
    const fromTable = Object.fromEntries(
      Object.entries(WORKBOOK_PAGE_PLATFORMS).map(([page, platforms]) => [
        page,
        [...platforms].sort(),
      ]),
    );

    expect(fromTable).toEqual(fromRegistry);
  });
});

describe('source_format_id backfills', () => {
  it.each(Object.entries(SOURCE_FORMAT_MIGRATIONS))(
    '%s: each pair is an adapter parent table and that adapter Trendyol v1 format id',
    (_migration, folder) => {
      const pairs = sourceFormatBackfills(readMigrationSql(folder));

      expect(pairs.map((pair) => pair.table).sort()).toEqual(
        ADAPTERS.map((adapter) => adapter.parentTable).sort(),
      );
      for (const pair of pairs) {
        const adapter = ADAPTERS.find((candidate) => candidate.parentTable === pair.table);
        if (adapter === undefined) throw new Error(`no adapter writes ${pair.table}`);
        expect(pair.id).toBe(backfilledFormatId(adapter));
        expect(pair.id.length).toBeLessThanOrEqual(SOURCE_FORMAT_ID_MAX_LENGTH);
      }
    },
  );
});

describe('real files uploaded on another page', () => {
  it('names every .xlsx under tests/fixtures, and every page has one', () => {
    const files = readdirSync(FIXTURES_DIR)
      .filter((name) => name.endsWith('.xlsx'))
      .sort();
    expect(files).toEqual(Object.keys(FIXTURE_PAGES).sort());
    expect([...new Set(Object.values(FIXTURE_PAGES))].sort()).toEqual(
      Object.values(WORKBOOK_PAGES).sort(),
    );
  });

  it.each(Object.entries(FIXTURE_PAGES))(
    '%s is diagnosed as its own format on every other page',
    async (file, page) => {
      const grid = await readWorkbookGrid(readFileSync(resolve(FIXTURES_DIR, file)), {
        sheet: FIRST_SHEET,
      });
      const headerRow = grid[0] ?? [];
      const ownId = backfilledFormatId(adapterOf(page));

      for (const otherPage of Object.values(WORKBOOK_PAGES)) {
        if (otherPage === page) continue;
        expect(diagnoseWorkbook(headerRow, FORMAT_SUMMARIES, otherPage)?.id, otherPage).toBe(ownId);
      }
    },
  );
});
