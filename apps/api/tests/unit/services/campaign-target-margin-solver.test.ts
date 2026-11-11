// Proves the campaign target-margin suggestion rides on the engine's closed-form price solver
// (`solveTrendyolScenarioPrice`) and never scores prices itself with `evaluateTrendyolScenario`
// -- i.e. no binary search and no per-price scan lives in the API layer. The real profit module
// is spied (importOriginal) so the solve still runs for real; only the call counts are asserted.

import { Decimal } from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';

import { evaluateTrendyolScenario, solveTrendyolScenarioPrice } from '@pazarsync/profit';

import {
  suggestTargetMarginPrices,
  type CampaignTargetMarginItem,
} from '@/services/marketplace-campaign-compute.service';
import {
  type DiscountCommissionInputs,
  type DiscountConfig,
} from '@/services/discount-math-commons';
import {
  createRequestFailureLog,
  type ScreenScenarioBase,
} from '@/services/scenario-screen-commons';

import { makeDiscountScenarioBase } from '../../helpers/scenario-base';

vi.mock('@pazarsync/profit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pazarsync/profit')>();
  return {
    ...actual,
    solveTrendyolScenarioPrice: vi.fn(actual.solveTrendyolScenarioPrice),
    evaluateTrendyolScenario: vi.fn(actual.evaluateTrendyolScenario),
  };
});

const d = (v: string | number): Decimal => new Decimal(v);

const readyBase = (): ScreenScenarioBase => ({ kind: 'ready', base: makeDiscountScenarioBase() });

const openCommission: DiscountCommissionInputs = {
  bands: [{ key: 'all', lowerLimit: null, upperLimit: null, commissionPct: '15' }],
  productRate: null,
  categoryRate: null,
};

const CONFIG: DiscountConfig = { type: 'NET', valueKind: 'PERCENT', value: d(10) };

describe('suggestTargetMarginPrices never binary-searches the target margin price', () => {
  it('calls the closed-form solver once per calculable item and scores no price itself', () => {
    vi.mocked(solveTrendyolScenarioPrice).mockClear();
    vi.mocked(evaluateTrendyolScenario).mockClear();

    const items: CampaignTargetMarginItem[] = [
      { itemId: 'a', base: readyBase(), commission: openCommission, maxPrice: d(1000) },
      { itemId: 'b', base: readyBase(), commission: openCommission, maxPrice: d(800) },
      { itemId: 'c', base: readyBase(), commission: openCommission, maxPrice: d(500) },
    ];

    const out = suggestTargetMarginPrices({
      items,
      config: CONFIG,
      fundingPct: d(0),
      targetMarginPct: d(10),
      failureLog: createRequestFailureLog({
        surface: 'marketplace-campaign',
        organizationId: 'org-test',
      }),
    });

    // Every item resolves to a real price (target 10% is reachable for all three ceilings).
    expect(out.every((s) => s.reason === null && s.price !== null)).toBe(true);
    // Exactly one closed-form solve per calculable item -- not O(log range) probes.
    expect(vi.mocked(solveTrendyolScenarioPrice)).toHaveBeenCalledTimes(items.length);
    // The suggestion never scores a price with the scenario evaluator itself.
    expect(vi.mocked(evaluateTrendyolScenario)).not.toHaveBeenCalled();
  });
});
