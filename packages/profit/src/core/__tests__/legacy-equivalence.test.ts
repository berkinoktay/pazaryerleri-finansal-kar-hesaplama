import { describe, expect, it } from 'vitest';

import { LEGACY_PROFIT_SCENARIOS } from '../../__tests__/fixtures/legacy-profit-scenarios';
import { linesFromLegacyInput } from '../../__tests__/helpers/lines-from-legacy-input';
import { computeProfit } from '../../profit-formula';
import { computeProfitStatement } from '../profit-statement';

describe.each(LEGACY_PROFIT_SCENARIOS)('legacy scenario: $name', ({ input }) => {
  it('matches computeProfit net VAT, net profit and margins', () => {
    const legacy = computeProfit(input);
    const s = computeProfitStatement({
      lines: linesFromLegacyInput(input),
      view: 'BEST_KNOWN',
      settings: { includeStopaj: true, includeNegativeNetVat: input.includeNegativeNetVat },
      isExportSale: false,
      isCancelled: false,
      isExcluded: false,
      issues: [],
    });
    expect(s.netProfit?.equals(legacy.netProfit)).toBe(true);
    expect(s.vat.effective.equals(legacy.netVat)).toBe(true);
    expect(s.saleMarginPct === null ? null : s.saleMarginPct.toString()).toBe(
      legacy.saleMarginPct === null ? null : legacy.saleMarginPct.toString(),
    );
    expect(s.costMarkupPct === null ? null : s.costMarkupPct.toString()).toBe(
      legacy.costMarkupPct === null ? null : legacy.costMarkupPct.toString(),
    );
  });
});

it('covers all twelve legacy scenarios', () => {
  expect(LEGACY_PROFIT_SCENARIOS).toHaveLength(12);
});
