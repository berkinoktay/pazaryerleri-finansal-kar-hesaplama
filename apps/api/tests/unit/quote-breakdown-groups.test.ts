import type { ProfitBreakdown } from '@pazarsync/profit';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { serializeBreakdown } from '@/services/product-pricing.service';

/**
 * Full domain ProfitBreakdown with sane, self-consistent numbers so the derived
 * group totals can be asserted: the four allocation groups (cost + marketplace
 * fees + taxes + net profit) MUST close to saleGross for the "satış nereye gitti"
 * bar to render without a gap.
 *
 *   sale 450 − cost 180 − marketplace 90.20 − taxes(stoppage 5 + netVat 42.20) = 132.60
 */
function breakdown(overrides: Partial<ProfitBreakdown> = {}): ProfitBreakdown {
  return {
    listGross: new Decimal('500.00'),
    sellerDiscountGross: new Decimal('50.00'),
    saleGross: new Decimal('450.00'),
    saleVat: new Decimal('75.00'),
    costGross: new Decimal('180.00'),
    costVat: new Decimal('30.00'),
    commissionGross: new Decimal('85.50'),
    commissionVat: new Decimal('14.25'),
    shippingGross: new Decimal('34.70'),
    shippingVat: new Decimal('5.78'),
    platformServiceGross: new Decimal('0.00'),
    platformServiceVat: new Decimal('0.00'),
    stoppage: new Decimal('5.00'),
    netVat: new Decimal('42.20'),
    netProfit: new Decimal('132.60'),
    saleMarginPct: new Decimal('29.47'),
    costMarkupPct: new Decimal('73.67'),
    ...overrides,
  };
}

describe('serializeBreakdown — allocation group totals', () => {
  it('sums taxes as stoppage + net VAT', () => {
    expect(serializeBreakdown(breakdown()).taxesGross).toBe('47.20');
  });

  it('derives total deductions as saleGross − netProfit', () => {
    expect(serializeBreakdown(breakdown()).totalDeductionsGross).toBe('317.40');
  });

  it('derives marketplace fees as total deductions − cost − taxes', () => {
    // 317.40 − 180.00 − 47.20 = 90.20 (commission 85.50 + shipping 34.70 net,
    // captured via the sale−profit derivation, not a re-sum on the wire).
    expect(serializeBreakdown(breakdown()).marketplaceFeesGross).toBe('90.20');
  });

  it('keeps the four groups closing to saleGross (bar has no gap)', () => {
    const bd = serializeBreakdown(breakdown());
    const sum = new Decimal(bd.costGross)
      .add(bd.marketplaceFeesGross)
      .add(bd.taxesGross)
      .add(bd.netProfit);
    expect(sum.toFixed(2)).toBe(bd.saleGross);
  });

  it('folds a fee without its own bucket (e.g. micro-export) into marketplace fees', () => {
    // netProfit drops by 12 (a hidden international fee) with no named field; the
    // sale−profit derivation still closes the bar, absorbing it into marketplace.
    const bd = serializeBreakdown(breakdown({ netProfit: new Decimal('120.60') }));
    expect(bd.marketplaceFeesGross).toBe('102.20');
    const sum = new Decimal(bd.costGross)
      .add(bd.marketplaceFeesGross)
      .add(bd.taxesGross)
      .add(bd.netProfit);
    expect(sum.toFixed(2)).toBe(bd.saleGross);
  });
});
