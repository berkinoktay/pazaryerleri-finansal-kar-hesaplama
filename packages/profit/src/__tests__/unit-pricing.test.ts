import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  buildUnitProfitInput,
  computeUnitProfit,
  solvePriceForTarget,
  type UnitEconomics,
} from '../unit-pricing';

const D = (v: string) => new Decimal(v);

const ECON: UnitEconomics = {
  saleVatRate: D('20'),
  cost: { gross: D('120'), vat: D('20') },
  commissionRate: D('18'),
  commissionVatRate: D('20'),
  stoppageRate: D('0.01'),
  fixedFees: [{ type: 'SHIPPING', gross: D('40'), vat: D('6.6666666667'), direction: 'DEBIT' }],
};

describe('computeUnitProfit', () => {
  it('computes the full breakdown at a price', () => {
    const econ: UnitEconomics = {
      saleVatRate: D('0'),
      cost: { gross: D('50'), vat: D('0') },
      commissionRate: D('10'),
      commissionVatRate: D('0'),
      stoppageRate: D('0'),
      fixedFees: [],
    };
    // netProfit = P − cost − commission = 100 − 50 − 10 = 40
    expect(computeUnitProfit(econ, D('100')).netProfit.toString()).toBe('40');
  });
});

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

// Lineer ekonomi: netProfit = 0.9·P − 50  (A=0.9, B=−50)
const LINEAR: UnitEconomics = {
  saleVatRate: D('0'),
  cost: { gross: D('50'), vat: D('0') },
  commissionRate: D('10'),
  commissionVatRate: D('0'),
  stoppageRate: D('0'),
  fixedFees: [],
};

describe('solvePriceForTarget', () => {
  it('profit target: ₺40 → price 100', () => {
    const r = solvePriceForTarget(LINEAR, { type: 'profit', value: D('40') });
    expect(r.calculable).toBe(true);
    if (r.calculable) {
      expect(r.price.toString()).toBe('100');
      expect(r.breakdown.netProfit.toFixed(2)).toBe('40.00');
    }
  });

  it('margin target: 25% → price ~76.92, margin ~25%', () => {
    const r = solvePriceForTarget(LINEAR, { type: 'margin', value: D('25') });
    expect(r.calculable).toBe(true);
    if (r.calculable) {
      expect(r.price.toFixed(2)).toBe('76.92');
      expect(r.breakdown.saleMarginPct?.toFixed(0)).toBe('25');
    }
  });

  it('markup target: 60% → price ~88.89, markup ~60%', () => {
    const r = solvePriceForTarget(LINEAR, { type: 'markup', value: D('60') });
    expect(r.calculable).toBe(true);
    if (r.calculable) {
      expect(r.price.toFixed(2)).toBe('88.89');
      expect(r.breakdown.costMarkupPct?.toFixed(0)).toBe('60');
    }
  });

  it('unreachable margin (≥ asymptote A=90%) → calculable false', () => {
    const r = solvePriceForTarget(LINEAR, { type: 'margin', value: D('95') });
    expect(r).toEqual({ calculable: false, reason: 'UNREACHABLE_TARGET' });
  });

  it('not price-sensitive (commission > 100%) → calculable false', () => {
    const econ: UnitEconomics = { ...LINEAR, commissionRate: D('120') };
    const r = solvePriceForTarget(econ, { type: 'profit', value: D('10') });
    expect(r).toEqual({ calculable: false, reason: 'NOT_PRICE_SENSITIVE' });
  });

  it('markup target with zero cost → calculable false', () => {
    const econ: UnitEconomics = { ...LINEAR, cost: { gross: D('0'), vat: D('0') } };
    const r = solvePriceForTarget(econ, { type: 'markup', value: D('60') });
    expect(r).toEqual({ calculable: false, reason: 'NO_COST' });
  });

  it('profit target below the P=0 floor → calculable false', () => {
    // B = -50 (profit at price 0); target -100 → P = (-100 - (-50))/0.9 < 0
    const r = solvePriceForTarget(LINEAR, { type: 'profit', value: D('-100') });
    expect(r).toEqual({ calculable: false, reason: 'UNREACHABLE_TARGET' });
  });
});
