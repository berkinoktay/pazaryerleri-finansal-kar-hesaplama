/**
 * Unit tests for `isTrendyolBaremEligible` - the pure Barem eligibility rule shared
 * by the variant-level shipping estimator and the scenario loader. No I/O.
 */

import { describe, expect, it } from 'vitest';

import { isTrendyolBaremEligible } from '../barem-eligibility';

describe('isTrendyolBaremEligible', () => {
  it('is eligible when the delivery duration is within the carrier window', () => {
    expect(
      isTrendyolBaremEligible({ deliveryDurationDays: 0, carrierMaxBaremDurationDays: 1 }),
    ).toBe(true);
    expect(
      isTrendyolBaremEligible({ deliveryDurationDays: 1, carrierMaxBaremDurationDays: 1 }),
    ).toBe(true);
  });

  it('is not eligible when the delivery duration exceeds the carrier window', () => {
    expect(
      isTrendyolBaremEligible({ deliveryDurationDays: 2, carrierMaxBaremDurationDays: 1 }),
    ).toBe(false);
  });

  it('is not eligible when the delivery duration is unknown (null)', () => {
    expect(
      isTrendyolBaremEligible({ deliveryDurationDays: null, carrierMaxBaremDurationDays: 1 }),
    ).toBe(false);
  });

  it('is not eligible when there is no carrier window (null)', () => {
    expect(
      isTrendyolBaremEligible({ deliveryDurationDays: 0, carrierMaxBaremDurationDays: null }),
    ).toBe(false);
    expect(
      isTrendyolBaremEligible({ deliveryDurationDays: null, carrierMaxBaremDurationDays: null }),
    ).toBe(false);
  });
});
