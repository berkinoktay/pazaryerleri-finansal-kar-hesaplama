import { describe, expect, it } from 'vitest';

import { compareFixedDecimal, resolveBestChoice } from '@/features/campaigns/lib/best-choice';
import type { CommissionTariffRow, PriceBand } from '@/features/campaigns/types';

/** Minimal band — only `key` and `netProfit` matter to the resolver. */
function band(key: string, netProfit: string | null): PriceBand {
  return {
    key,
    lowerLimit: null,
    upperLimit: null,
    price: '100.00',
    commissionPct: '10',
    netProfit,
    marginPct: netProfit,
  };
}

/** A row carrying only the two fields the resolver reads. */
function row(
  currentNetProfit: string | null,
  bands: PriceBand[],
): Pick<CommissionTariffRow, 'currentNetProfit' | 'bands'> {
  return { currentNetProfit, bands };
}

describe('compareFixedDecimal', () => {
  it('orders by numeric value, not lexical string order', () => {
    expect(compareFixedDecimal('9.00', '100.00')).toBeLessThan(0);
    expect(compareFixedDecimal('100.00', '9.00')).toBeGreaterThan(0);
  });

  it('treats numerically equal values as 0', () => {
    expect(compareFixedDecimal('50.00', '50.00')).toBe(0);
  });

  it('treats 0.00 and -0.00 as equal', () => {
    expect(compareFixedDecimal('0.00', '-0.00')).toBe(0);
    expect(compareFixedDecimal('-0.00', '0.00')).toBe(0);
  });

  it('orders negatives so the least loss is the greater value', () => {
    expect(compareFixedDecimal('-10.00', '-20.00')).toBeGreaterThan(0);
    expect(compareFixedDecimal('-20.00', '-10.00')).toBeLessThan(0);
    expect(compareFixedDecimal('-5.00', '5.00')).toBeLessThan(0);
  });

  it('compares differing fraction lengths exactly (no rounding)', () => {
    expect(compareFixedDecimal('1.5', '1.50')).toBe(0);
    expect(compareFixedDecimal('1.05', '1.5')).toBeLessThan(0);
    expect(compareFixedDecimal('1234.567', '1234.56')).toBeGreaterThan(0);
  });

  it('handles an integer input with no fraction ("100" vs "99.50")', () => {
    expect(compareFixedDecimal('100', '99.50')).toBeGreaterThan(0);
    expect(compareFixedDecimal('99.50', '100')).toBeLessThan(0);
  });

  it('handles a leading-dot fraction (".5" equals "0.50")', () => {
    expect(compareFixedDecimal('.5', '0.50')).toBe(0);
    expect(compareFixedDecimal('0.50', '.5')).toBe(0);
  });
});

describe('resolveBestChoice', () => {
  it('returns the FIRST max band when only bands are calculable', () => {
    // band2 and band3 tie at 30.00 → the earlier one (band2) wins.
    const r = row(null, [
      band('band1', '10.00'),
      band('band2', '30.00'),
      band('band3', '30.00'),
      band('band4', '5.00'),
    ]);
    expect(resolveBestChoice(r, null)).toBe('band2');
  });

  it("returns 'current' when the current profit is strictly greater than every band", () => {
    const r = row('40.00', [band('band1', '10.00'), band('band2', '30.00')]);
    expect(resolveBestChoice(r, null)).toBe('current');
  });

  it('keeps the band on a current/band tie (band beats current)', () => {
    const r = row('30.00', [band('band1', '10.00'), band('band2', '30.00')]);
    expect(resolveBestChoice(r, null)).toBe('band2');
  });

  it("returns 'custom' when the custom profit is strictly the largest", () => {
    const r = row('30.00', [band('band1', '10.00'), band('band2', '30.00')]);
    expect(resolveBestChoice(r, '45.00')).toBe('custom');
  });

  it('requires custom to be STRICTLY greater — a tie keeps the band', () => {
    const r = row(null, [band('band1', '30.00')]);
    expect(resolveBestChoice(r, '30.00')).toBe('band1');
  });

  it('ignores a custom candidate whose profit is null', () => {
    const r = row(null, [band('band1', '10.00'), band('band2', '30.00')]);
    expect(resolveBestChoice(r, null)).toBe('band2');
  });

  it('returns null when no option has a calculable profit', () => {
    const r = row(null, [band('band1', null), band('band2', null)]);
    expect(resolveBestChoice(r, null)).toBeNull();
  });

  it('returns null when every candidate is a loss (a loss is never "En kârlı")', () => {
    // Even the least loss (band2 at -10) does NOT win — no positive candidate exists.
    const r = row('-30.00', [
      band('band1', '-50.00'),
      band('band2', '-10.00'),
      band('band3', '-80.00'),
    ]);
    expect(resolveBestChoice(r, '-5.00')).toBeNull();
    expect(resolveBestChoice(r, null)).toBeNull();
  });

  it('excludes a break-even "0.00" candidate — only strictly positive wins', () => {
    // current + every band sit at exactly break-even → no eligible candidate.
    const r = row('0.00', [band('band1', '0.00'), band('band2', '-0.00')]);
    expect(resolveBestChoice(r, '0.00')).toBeNull();
  });

  it('picks the positive current over negative bands (mixed signs)', () => {
    // The bands all lose money; only the current price is profitable → current wins.
    const r = row('12.00', [band('band1', '-50.00'), band('band2', '-10.00')]);
    expect(resolveBestChoice(r, null)).toBe('current');
  });

  it("returns 'current' when no band is calculable but current is positive", () => {
    const r = row('12.00', [band('band1', null), band('band2', null)]);
    expect(resolveBestChoice(r, null)).toBe('current');
  });

  it("returns 'custom' when it is the only strictly-positive option", () => {
    const r = row(null, [band('band1', null)]);
    expect(resolveBestChoice(r, '7.00')).toBe('custom');
  });
});
