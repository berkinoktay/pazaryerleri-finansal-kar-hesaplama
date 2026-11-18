// Every real marketplace file under tests/fixtures resolves the write columns its format's
// export requires. The import refuses a file that does not (NO_WRITEBACK_COLUMN on
// `file`), so this is the proof that no real file is refused by that rule.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { readWorkbookGrid, type LayoutSpec } from '@pazarsync/spreadsheet';
import { describe, expect, it, vi } from 'vitest';

import type { WorkbookFormat } from '@/workbooks/format';
import { FORMAT_SUMMARIES } from '@/workbooks/formats/registry';
import { trendyolAdvantageTariffFormat } from '@/workbooks/formats/trendyol/advantage-tariff.format';
import { trendyolCommissionTariffFormat } from '@/workbooks/formats/trendyol/commission-tariff.format';
import { trendyolDiscountListFormat } from '@/workbooks/formats/trendyol/discount-list.format';
import { trendyolFlashProductListFormat } from '@/workbooks/formats/trendyol/flash-product-list.format';
import { trendyolMarketplaceCampaignListFormat } from '@/workbooks/formats/trendyol/marketplace-campaign-list.format';
import { trendyolPlusCommissionTariffFormat } from '@/workbooks/formats/trendyol/plus-commission-tariff.format';
import { selectFormat } from '@/workbooks/select-format';
import { missingExportRequirement, resolveWriteColumns } from '@/workbooks/write-columns';

// The fixtures are read through the parse worker, whose cold start can pass vitest's 5 s
// default under load.
vi.setConfig({ testTimeout: 60_000 });

const FIXTURES_DIR = resolve(__dirname, '../../fixtures');

interface FixtureCase {
  readonly fixture: string;
  readonly formatId: string;
  /** True when some `exportRequires` group of the format has no resolved write column. */
  readonly missing: () => Promise<boolean>;
}

/** One row of the table: a real fixture and the format it belongs to. */
function fixtureCase<S extends LayoutSpec, TRow, TWrite extends string>(
  fixture: string,
  format: WorkbookFormat<S, TRow, TWrite>,
): FixtureCase {
  return {
    fixture,
    formatId: format.id,
    missing: async () => {
      const file = readFileSync(resolve(FIXTURES_DIR, fixture));
      const selected = await selectFormat(file, [format], {
        read: (bytes, sheet) => readWorkbookGrid(bytes, { sheet }),
        summaries: FORMAT_SUMMARIES,
      });
      const resolved = resolveWriteColumns(selected.format, selected.layout);
      return missingExportRequirement(selected.format, resolved);
    },
  };
}

const CASES: readonly FixtureCase[] = [
  fixtureCase('trendyol-commission-tariff.xlsx', trendyolCommissionTariffFormat),
  fixtureCase('trendyol-tariff-1period.xlsx', trendyolCommissionTariffFormat),
  fixtureCase('trendyol-plus-tariff.xlsx', trendyolPlusCommissionTariffFormat),
  fixtureCase('trendyol-plus-tariff-3ve4.xlsx', trendyolPlusCommissionTariffFormat),
  fixtureCase('trendyol-advantage-tariff.xlsx', trendyolAdvantageTariffFormat),
  fixtureCase('trendyol-flash-products.xlsx', trendyolFlashProductListFormat),
  fixtureCase('trendyol-discount-products.xlsx', trendyolDiscountListFormat),
  fixtureCase('marketplace-campaign-sample.xlsx', trendyolMarketplaceCampaignListFormat),
];

describe('every real fixture resolves the write columns its export requires', () => {
  it.each(CASES)('$fixture ($formatId)', async ({ missing }) => {
    expect(await missing()).toBe(false);
  });
});
