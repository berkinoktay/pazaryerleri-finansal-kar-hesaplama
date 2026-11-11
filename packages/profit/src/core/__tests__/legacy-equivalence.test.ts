import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { LEGACY_PROFIT_SCENARIOS } from '../../__tests__/fixtures/legacy-profit-scenarios';
import { linesFromLegacyInput } from '../../__tests__/helpers/lines-from-legacy-input';
import { computeProfitStatement } from '../profit-statement';

/**
 * Proves the new core reproduces the twelve legacy `computeProfit` scenarios. The
 * expected values were produced once from the legacy `computeProfit` engine on
 * 2026-11-11 and frozen into the scenario fixtures; the legacy engine was deleted
 * in Faz 5.
 */
describe.each(LEGACY_PROFIT_SCENARIOS)('legacy scenario: $name', ({ input, expected }) => {
  it('matches the frozen legacy net VAT, net profit and margins', () => {
    const s = computeProfitStatement({
      lines: linesFromLegacyInput(input),
      view: 'BEST_KNOWN',
      settings: { includeStopaj: true, includeNegativeNetVat: input.includeNegativeNetVat },
      isExportSale: false,
      isCancelled: false,
      isExcluded: false,
      issues: [],
    });
    expect(s.netProfit?.equals(new Decimal(expected.netProfit))).toBe(true);
    expect(s.vat.effective.equals(new Decimal(expected.netVat))).toBe(true);
    expect(s.saleMarginPct === null ? null : s.saleMarginPct.toString()).toBe(
      expected.saleMarginPct,
    );
    expect(s.costMarkupPct === null ? null : s.costMarkupPct.toString()).toBe(
      expected.costMarkupPct,
    );
  });
});

it('covers all twelve legacy scenarios', () => {
  expect(LEGACY_PROFIT_SCENARIOS).toHaveLength(12);
});
