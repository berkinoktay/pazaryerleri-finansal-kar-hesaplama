import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { foldFullReturnDomestic } from '../compute-return-scenario';
import type { ProfitInput } from '../profit-formula';

const D = (v: string) => new Decimal(v);

const base: ProfitInput = {
  sale: { gross: D('850'), vat: D('141.67') },
  cost: { gross: D('500'), vat: D('83.33') },
  commission: { gross: D('96'), vat: D('16') },
  fees: [{ type: 'PLATFORM_SERVICE', gross: D('10.19'), vat: D('1.70'), direction: 'DEBIT' }],
  stoppage: { gross: D('7.08') },
  includeNegativeNetVat: false,
};

describe('foldFullReturnDomestic', () => {
  it('full return zeroes sale/cost/commission/stoppage; keeps forward fees; adds return shipping', () => {
    // İade kargosu gross 150, vat 25 (KDV %20: 150 × 20/120 = 25).
    const r = foldFullReturnDomestic(base, { gross: D('150'), vat: D('25') });
    // sale/cost/commission/stoppage → 0; kalan: forward PSF (10.19) + iade kargosu (150).
    // netVat = 0 − 0 − 0 − (PSF vat 1.70 + return ship vat 25) + 0 = −26.70
    //   includeNegativeNetVat=false → effectiveNetVat = max(−26.70, 0) = 0
    // netProfit = 0 − 0 − 0 − (10.19 + 150) − 0 − 0 = −160.19
    expect(r.netProfit.toFixed(2)).toBe('-160.19');
    // saleGross 0 → saleMarginPct null
    expect(r.saleMarginPct).toBeNull();
  });

  it('positive net VAT case: includeNegativeNetVat irrelevant when netVat ≥ 0', () => {
    const r = foldFullReturnDomestic(
      { ...base, includeNegativeNetVat: true },
      { gross: D('0'), vat: D('0') },
    );
    // İade kargosu 0 → netVat = −PSF vat 1.70 (negatif); true → korunur → +1.70 kâra
    // netProfit = 0 − 10.19 − (−1.70) = −8.49
    expect(r.netProfit.toFixed(2)).toBe('-8.49');
  });
});
