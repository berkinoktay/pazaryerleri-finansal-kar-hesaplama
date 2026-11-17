import { describe, expect, it } from 'vitest';

import { outcomeReason } from '@/services/scenario-screen-commons';

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
