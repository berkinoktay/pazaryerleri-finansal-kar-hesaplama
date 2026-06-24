import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  computeNetSaleGross,
  foldReturnLegs,
  resolveReturnLegs,
  type ReturnFeeRow,
} from '../fold-return-legs';
import type { ProfitInput } from '../profit-formula';

const D = (v: string | number) => new Decimal(v);

const baseInput = (): ProfitInput => ({
  // KDV %10 tutarlı: vat = gross × 10/110 (tam iade clamp'sız tam 0'a katlanır)
  sale: { gross: D('2361.71'), vat: D('2361.71').mul(10).div(110) },
  cost: { gross: D('0'), vat: D('0') },
  commission: { gross: D('0'), vat: D('0') },
  fees: [{ type: 'SHIPPING', gross: D('155.99'), vat: D('25.99'), direction: 'DEBIT' }],
  stoppage: { gross: D('0') },
});

describe('computeNetSaleGross', () => {
  it('returns gross sale unchanged when there are no return deductions', () => {
    expect(computeNetSaleGross(D('90'), []).toString()).toBe('90');
  });

  it('subtracts the estimate refund deduction when no settlement exists', () => {
    const net = computeNetSaleGross(D('90'), [
      { source: 'ESTIMATE', amountGross: D('30'), vatRate: D('20') },
    ]);
    expect(net.toString()).toBe('60');
  });

  it('prefers the settlement refund over the estimate (no double-count)', () => {
    const net = computeNetSaleGross(D('90'), [
      { source: 'ESTIMATE', amountGross: D('90'), vatRate: D('20') },
      { source: 'SETTLEMENT', amountGross: D('88'), vatRate: D('20') },
    ]);
    expect(net.toString()).toBe('2');
  });

  it('nets a fully returned order to zero', () => {
    const net = computeNetSaleGross(D('90'), [
      { source: 'SETTLEMENT', amountGross: D('90'), vatRate: D('20') },
    ]);
    expect(net.toString()).toBe('0');
  });

  it('treats non-actual sources (USER_OVERRIDE / MANUAL_ENTRY) as estimate', () => {
    const net = computeNetSaleGross(D('90'), [
      { source: 'USER_OVERRIDE', amountGross: D('10'), vatRate: D('20') },
    ]);
    expect(net.toString()).toBe('80');
  });
});

describe('resolveReturnLegs', () => {
  it('prefers actual (SETTLEMENT/CARGO_INVOICE) over ESTIMATE per leg', () => {
    const rows: ReturnFeeRow[] = [
      {
        feeType: 'REFUND_DEDUCTION',
        source: 'ESTIMATE',
        amountGross: D('2361.71'),
        vatRate: D('10'),
      },
      {
        feeType: 'REFUND_DEDUCTION',
        source: 'SETTLEMENT',
        amountGross: D('2360.00'),
        vatRate: D('10'),
      },
      {
        feeType: 'RETURN_SHIPPING',
        source: 'ESTIMATE',
        amountGross: D('155.99'),
        vatRate: D('20'),
      },
      // COST_RETURN: CARGO_INVOICE de (SETTLEMENT gibi) gerçek kaynak → ESTIMATE'i yener
      { feeType: 'COST_RETURN', source: 'ESTIMATE', amountGross: D('500.00'), vatRate: D('10') },
      {
        feeType: 'COST_RETURN',
        source: 'CARGO_INVOICE',
        amountGross: D('480.00'),
        vatRate: D('10'),
      },
    ];
    const legs = resolveReturnLegs(rows);
    expect(legs.REFUND_DEDUCTION.gross.toFixed(2)).toBe('2360.00');
    expect(legs.RETURN_SHIPPING.gross.toFixed(2)).toBe('155.99');
    expect(legs.RETURN_SHIPPING.vat.toFixed(2)).toBe('26.00');
    expect(legs.COST_RETURN.gross.toFixed(2)).toBe('480.00');
  });

  it('returns zero legs when no rows', () => {
    const legs = resolveReturnLegs([]);
    expect(legs.COST_RETURN.gross.toFixed(2)).toBe('0.00');
  });
});

describe('foldReturnLegs', () => {
  it('folds full return: sale to zero, return shipping appended to fees', () => {
    const rows: ReturnFeeRow[] = [
      {
        feeType: 'REFUND_DEDUCTION',
        source: 'ESTIMATE',
        amountGross: D('2361.71'),
        vatRate: D('10'),
      },
      {
        feeType: 'RETURN_SHIPPING',
        source: 'ESTIMATE',
        amountGross: D('155.99'),
        vatRate: D('20'),
      },
    ];
    const folded = foldReturnLegs(baseInput(), resolveReturnLegs(rows));
    expect(folded.sale.gross.toFixed(2)).toBe('0.00');
    expect(folded.sale.vat.toFixed(2)).toBe('0.00');
    const shipping = folded.fees.filter((f) => f.type === 'SHIPPING');
    expect(shipping).toHaveLength(2);
  });
});
