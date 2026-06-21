import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { buildUnitProfitInput, type UnitEconomics } from '../unit-pricing';

const D = (v: string) => new Decimal(v);

const ECON: UnitEconomics = {
  saleVatRate: D('20'),
  cost: { gross: D('120'), vat: D('20') },
  commissionRate: D('18'),
  commissionVatRate: D('20'),
  stoppageRate: D('0.01'),
  fixedFees: [{ type: 'SHIPPING', gross: D('40'), vat: D('6.6666666667'), direction: 'DEBIT' }],
};

describe('buildUnitProfitInput', () => {
  it('assembles a ProfitInput at a given price (no intermediate rounding)', () => {
    const input = buildUnitProfitInput(ECON, D('100'));
    expect(input.sale.gross.toString()).toBe('100');
    // saleVat = 100 × 20 / 120
    expect(input.sale.vat.toFixed(4)).toBe('16.6667');
    // commissionGross = 100 × 18 / 100 = 18
    expect(input.commission.gross.toString()).toBe('18');
    // commissionVat = 18 × 20 / 120 = 3
    expect(input.commission.vat.toString()).toBe('3');
    // stoppage = (saleGross − saleVat) × 0.01 = (100 − 16.6667) × 0.01
    expect(input.stoppage.gross.toFixed(4)).toBe('0.8333');
    expect(input.cost.gross.toString()).toBe('120');
    expect(input.fees).toHaveLength(1);
  });
});
