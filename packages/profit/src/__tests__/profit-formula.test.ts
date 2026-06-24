/**
 * Unit tests for `computeProfit()` — pure function, no DB required.
 * GROSS convention (spec §2). Task 11 = happy path; Task 12 = edge cases.
 */

import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { computeProfit, type ProfitInput } from '../profit-formula';

const D = (v: string) => new Decimal(v);

describe('computeProfit — GROSS convention', () => {
  it('happy path: 120 sale / 60 cost / 12 commission / 6 shipping / 1 stoppage', () => {
    const input: ProfitInput = {
      sale: { gross: D('120'), vat: D('20') },
      cost: { gross: D('60'), vat: D('10') },
      commission: { gross: D('12'), vat: D('2') },
      fees: [{ type: 'SHIPPING', gross: D('6'), vat: D('1'), direction: 'DEBIT' }],
      stoppage: { gross: D('1') },
    };
    const r = computeProfit(input);
    // netVat = 20 − (10+2+1) = 7
    // netProfit = 120 − 60 − 12 − 6 − 1 − 7 = 34
    expect(r.netVat.toString()).toBe('7');
    expect(r.netProfit.toString()).toBe('34');
    expect(r.saleMarginPct?.toFixed(2)).toBe('28.33'); // 34/120×100
    expect(r.costMarkupPct?.toFixed(2)).toBe('56.67'); // 34/60×100
  });

  it('micro export: international service fee is a DEBIT, not a platform-service bucket; sale VAT %0 reclaims input VAT', () => {
    const r = computeProfit({
      // Mikro ihracat: satış KDV %0 (ihracat istisnası); komisyon/kargo TR ile aynı;
      // PSF yok; stopaj yok; Uluslararası Hizmet Bedeli (%6) DEBIT.
      sale: { gross: D('1000'), vat: D('0') },
      cost: { gross: D('600'), vat: D('60') },
      commission: { gross: D('190'), vat: D('38') },
      fees: [{ type: 'INTERNATIONAL_SERVICE', gross: D('60'), vat: D('10'), direction: 'DEBIT' }],
      stoppage: { gross: D('0') },
    });
    // netVat = 0 − 60 − 38 − 10 = −108 (girdi-KDV mahsubu → negatif → kâra ekler)
    // netProfit = 1000 − 600 − 190 − 60 − 0 − (−108) = 258
    expect(r.netVat.toString()).toBe('-108');
    expect(r.netProfit.toString()).toBe('258');
    // Uluslararası Hizmet Bedeli platformService/shipping kovasına KARIŞMAMALI.
    expect(r.platformServiceGross.toString()).toBe('0');
    expect(r.platformServiceVat.toString()).toBe('0');
    expect(r.shippingGross.toString()).toBe('0');
  });

  // ── Task 12: edge cases ──────────────────────────────────────────────────

  it('negative Net VAT when input VAT > sale VAT', () => {
    const r = computeProfit({
      sale: { gross: D('100'), vat: D('5') },
      cost: { gross: D('50'), vat: D('10') },
      commission: { gross: D('10'), vat: D('2') },
      fees: [],
      stoppage: { gross: D('0') },
    });
    // netVat = 5 − 10 − 2 = −7
    // netProfit = 100 − 50 − 10 − 0 − (−7) = 47
    expect(r.netVat.toString()).toBe('-7');
    expect(r.netProfit.toString()).toBe('47');
  });

  it('zero sale → saleMarginPct null', () => {
    const r = computeProfit({
      sale: { gross: D('0'), vat: D('0') },
      cost: { gross: D('50'), vat: D('10') },
      commission: { gross: D('0'), vat: D('0') },
      fees: [],
      stoppage: { gross: D('0') },
    });
    expect(r.saleMarginPct).toBeNull();
    // netVat = 0 − 10 = −10; netProfit = 0 − 50 − 0 − 0 − (−10) = −40
    // costMarkupPct = −40/50×100 = −80
    expect(r.costMarkupPct?.toString()).toBe('-80');
  });

  it('zero cost → costMarkupPct null', () => {
    const r = computeProfit({
      sale: { gross: D('100'), vat: D('20') },
      cost: { gross: D('0'), vat: D('0') },
      commission: { gross: D('0'), vat: D('0') },
      fees: [],
      stoppage: { gross: D('0') },
    });
    expect(r.costMarkupPct).toBeNull();
  });

  it('multi VAT-rate aggregation', () => {
    const r = computeProfit({
      sale: { gross: D('300'), vat: D('50') },
      cost: { gross: D('100'), vat: D('20') },
      commission: { gross: D('30'), vat: D('2.73') },
      fees: [{ type: 'SHIPPING', gross: D('10'), vat: D('0.10'), direction: 'DEBIT' }],
      stoppage: { gross: D('0') },
    });
    // netVat = 50 − 20 − 2.73 − 0.10 = 27.17
    expect(r.netVat.toString()).toBe('27.17');
  });

  it('stoppage reduces profit, NOT in netVat', () => {
    const r = computeProfit({
      sale: { gross: D('100'), vat: D('20') },
      cost: { gross: D('40'), vat: D('8') },
      commission: { gross: D('10'), vat: D('2') },
      fees: [],
      stoppage: { gross: D('0.83') },
    });
    // netVat = 20 − 8 − 2 = 10 (stopaj yok)
    expect(r.netVat.toString()).toBe('10');
    // netProfit = 100 − 40 − 10 − 0.83 − 10 = 39.17
    expect(r.netProfit.toString()).toBe('39.17');
  });

  it('CREDIT fee adds back to netVat and profit', () => {
    const r = computeProfit({
      sale: { gross: D('100'), vat: D('20') },
      cost: { gross: D('40'), vat: D('8') },
      commission: { gross: D('0'), vat: D('0') },
      fees: [
        { type: 'SHIPPING', gross: D('10'), vat: D('2'), direction: 'DEBIT' },
        { type: 'PLATFORM_SERVICE', gross: D('5'), vat: D('1'), direction: 'CREDIT' },
      ],
      stoppage: { gross: D('0') },
    });
    // netVat = 20 − 8 − 2 + 1 = 11
    expect(r.netVat.toString()).toBe('11');
  });

  it('algebraic equivalence: gross − netVat ≡ net-convention profit', () => {
    const input: ProfitInput = {
      sale: { gross: D('120'), vat: D('20') },
      cost: { gross: D('60'), vat: D('10') },
      commission: { gross: D('12'), vat: D('2') },
      fees: [{ type: 'SHIPPING', gross: D('6'), vat: D('1'), direction: 'DEBIT' }],
      stoppage: { gross: D('1') },
    };
    const r = computeProfit(input);
    // net convention: (120−20) − (60−10) − (12−2) − (6−1) − 1 = 100−50−10−5−1 = 34
    expect(r.netProfit.toString()).toBe('34');
  });
});
