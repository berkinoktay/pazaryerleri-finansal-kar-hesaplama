import { describe, expect, it } from 'vitest';

import { selectBestScenario } from '@/services/advantage-tariff-compute.service';
import type { StarTierKey } from '@/validators/advantage-tariff.validator';

/** Terse tier builder — only the two fields selectBestScenario reads. */
function tier(
  key: StarTierKey,
  netProfit: string | null,
): { key: StarTierKey; netProfit: string | null } {
  return { key, netProfit };
}

describe('selectBestScenario', () => {
  it('flags the CURRENT baseline when it out-earns every tier', () => {
    // Current 50 beats all lower-priced tiers → keep the current price.
    const result = selectBestScenario('50.00', [
      tier('tier1', '40.00'),
      tier('tier2', '30.00'),
      tier('tier3', '10.00'),
    ]);
    expect(result).toEqual({ bestTierKey: null, currentIsBest: true });
  });

  it('flags the winning TIER when dropping price is more profitable', () => {
    // tier2 (60) beats the current baseline (25) → drop to tier2.
    const result = selectBestScenario('25.00', [
      tier('tier1', '40.00'),
      tier('tier2', '60.00'),
      tier('tier3', '55.00'),
    ]);
    expect(result).toEqual({ bestTierKey: 'tier2', currentIsBest: false });
  });

  it('flags NOTHING when no scenario is profitable (all ≤ 0)', () => {
    const result = selectBestScenario('-5.00', [
      tier('tier1', '0.00'), // exactly zero is not "profitable"
      tier('tier2', '-1.00'),
      tier('tier3', '-10.00'),
    ]);
    expect(result).toEqual({ bestTierKey: null, currentIsBest: false });
  });

  it('breaks a tie in favor of the CURRENT baseline (no churn to move a badge)', () => {
    // Current ties tier1 at 40 → prefer keeping the current price.
    const result = selectBestScenario('40.00', [
      tier('tier1', '40.00'),
      tier('tier2', '20.00'),
      tier('tier3', null),
    ]);
    expect(result).toEqual({ bestTierKey: null, currentIsBest: true });
  });

  it('lets a positive TIER win when the current baseline is not calculable', () => {
    // current null (uncalculable) but tier1 is profitable → tier1 wins.
    const result = selectBestScenario(null, [
      tier('tier1', '15.00'),
      tier('tier2', null),
      tier('tier3', '-3.00'),
    ]);
    expect(result).toEqual({ bestTierKey: 'tier1', currentIsBest: false });
  });

  it('flags nothing when every scenario is null (fully uncalculable item)', () => {
    const result = selectBestScenario(null, [
      tier('tier1', null),
      tier('tier2', null),
      tier('tier3', null),
    ]);
    expect(result).toEqual({ bestTierKey: null, currentIsBest: false });
  });
});
