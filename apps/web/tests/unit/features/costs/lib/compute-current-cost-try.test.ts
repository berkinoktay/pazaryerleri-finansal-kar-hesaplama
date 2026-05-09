import { describe, expect, it } from 'vitest';

import { computeCurrentCostTry } from '@/features/costs/lib/compute-current-cost-try';

describe('computeCurrentCostTry', () => {
  it('TRY native: returns amount as-is (rate is 1)', () => {
    const result = computeCurrentCostTry({
      amount: '25.50',
      currency: 'TRY',
      fxRateMode: 'AUTO',
      manualFxRate: null,
      fxRate: null,
    });
    expect(result?.toFixed(2)).toBe('25.50');
  });

  it('USD MANUAL: returns amount × manualFxRate', () => {
    const result = computeCurrentCostTry({
      amount: '10.00',
      currency: 'USD',
      fxRateMode: 'MANUAL',
      manualFxRate: '35.5000',
      fxRate: null,
    });
    expect(result?.toFixed(2)).toBe('355.00');
  });

  it('USD AUTO with rate: returns amount × fx rate', () => {
    const result = computeCurrentCostTry({
      amount: '10.00',
      currency: 'USD',
      fxRateMode: 'AUTO',
      manualFxRate: null,
      fxRate: '35.0000',
    });
    expect(result?.toFixed(2)).toBe('350.00');
  });

  it('USD AUTO without rate (null): returns null (cannot compute)', () => {
    const result = computeCurrentCostTry({
      amount: '10.00',
      currency: 'USD',
      fxRateMode: 'AUTO',
      manualFxRate: null,
      fxRate: null,
    });
    expect(result).toBeNull();
  });

  it('EUR MANUAL with decimal amount: preserves precision', () => {
    const result = computeCurrentCostTry({
      amount: '5.99',
      currency: 'EUR',
      fxRateMode: 'MANUAL',
      manualFxRate: '37.750000',
      fxRate: null,
    });
    // 5.99 × 37.75 = 226.1225
    expect(result?.toFixed(4)).toBe('226.1225');
  });

  it('zero amount: returns 0', () => {
    const result = computeCurrentCostTry({
      amount: '0.00',
      currency: 'TRY',
      fxRateMode: 'AUTO',
      manualFxRate: null,
      fxRate: null,
    });
    expect(result?.toFixed(2)).toBe('0.00');
  });

  it('MANUAL mode ignores fxRate (uses manualFxRate)', () => {
    const result = computeCurrentCostTry({
      amount: '10.00',
      currency: 'USD',
      fxRateMode: 'MANUAL',
      manualFxRate: '35.00',
      fxRate: '99.00', // should be ignored
    });
    expect(result?.toFixed(2)).toBe('350.00');
  });
});
