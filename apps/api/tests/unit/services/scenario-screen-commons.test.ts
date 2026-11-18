import { describe, expect, it } from 'vitest';

import { outcomeReason, screenScenarioBaseFor } from '@/services/scenario-screen-commons';

// The calculable branch (an outcome with a statement) is covered through the commission,
// Plus and Flash compute tests, which build real outcomes with the scenario engine.
describe('outcomeReason', () => {
  it('is null when nothing was evaluated', () => {
    expect(outcomeReason(null)).toBeNull();
    expect(outcomeReason(undefined)).toBeNull();
  });

  it("is a not-calculable outcome's reason", () => {
    expect(outcomeReason({ calculable: false, reason: 'NO_COST' })).toBe('NO_COST');
    expect(outcomeReason({ calculable: false, reason: 'NO_SHIPPING' })).toBe('NO_SHIPPING');
  });

  it('is null for a not-calculable outcome without a reason', () => {
    expect(outcomeReason({ calculable: false, reason: null })).toBeNull();
  });
});

describe('screenScenarioBaseFor', () => {
  it('is degraded for every item of a read whose barcode lookup failed, never no-product', () => {
    // Such a read has no ids at all: without the flag it would read as no-product (the
    // seller's "product not matched" sentence), which is what the flag must prevent.
    expect(screenScenarioBaseFor(null, null, true)).toEqual({ kind: 'degraded' });
    expect(screenScenarioBaseFor(new Map(), null, true)).toEqual({ kind: 'degraded' });
  });

  it('is no-product for a barcode with no catalog variant when the lookup worked', () => {
    expect(screenScenarioBaseFor(new Map(), null, false)).toEqual({ kind: 'no-product' });
    expect(screenScenarioBaseFor(null, null, false)).toEqual({ kind: 'no-product' });
  });

  it('is degraded when the store-wide load failed for a found variant', () => {
    expect(screenScenarioBaseFor(null, 'variant-1', false)).toEqual({ kind: 'degraded' });
  });

  it('is no-product for a found variant the loader did not return', () => {
    expect(screenScenarioBaseFor(new Map(), 'variant-1', false)).toEqual({ kind: 'no-product' });
  });
});
