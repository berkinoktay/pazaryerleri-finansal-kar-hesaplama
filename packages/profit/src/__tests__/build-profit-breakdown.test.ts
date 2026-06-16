/**
 * Unit tests for buildProfitBreakdown — GROSS view adapter (Task 13).
 * Aggregates gross items + fees into 2-decimal string view with margins.
 */

import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { buildProfitBreakdown } from '../build-profit-breakdown';

const D = (v: string): Decimal => new Decimal(v);

describe('buildProfitBreakdown — GROSS view', () => {
  it('aggregates items + fees into gross view with margins', () => {
    const v = buildProfitBreakdown({
      saleGross: D('200'),
      saleVat: D('40'),
      listGross: D('200'),
      sellerDiscountGross: D('0'),
      items: [
        {
          quantity: 2,
          lineListGross: D('100'),
          lineSaleGross: D('100'),
          lineSellerDiscountGross: D('0'),
          saleVatRate: 20,
          commissionGross: D('20'),
          refundedCommissionGross: D('0'),
          commissionVatRate: 20,
          unitCostSnapshotGross: D('30'),
          unitCostSnapshotVatRate: 20,
        },
      ],
      fees: [{ feeType: 'SHIPPING', direction: 'DEBIT', amountGross: D('10'), vatRate: 20 }],
      netProfit: D('56'),
      netVat: D('14'),
      saleMarginPct: D('28'),
      costMarkupPct: D('56'),
    });
    expect(v.saleGross).toBe('200.00');
    expect(v.costGross).toBe('60.00'); // 30 × 2
    expect(v.shippingGross).toBe('10.00');
    expect(v.stoppage).toBe('0.00'); // STOPPAGE fee yok → '0.00'
    expect(v.netProfit).toBe('56.00');
    expect(v.saleMarginPct).toBe('28.00');
  });

  it('aggregates STOPPAGE fees as a separate deduction line that reconciles to netProfit', () => {
    // Stopaj ayrı düşülen terim; komisyon/PSF içine KATLANMAZ (çift-sayım yok).
    // computeProfit cebri: netProfit = saleGross − costGross − commissionGross
    //   − shippingGross − platformServiceGross − stoppage − netVat.
    // Burada: 1000 − 300 − 200 − 50 − 20 − 30 − 100 = 300.
    const v = buildProfitBreakdown({
      saleGross: D('1000'),
      saleVat: D('166.67'),
      listGross: D('1000'),
      sellerDiscountGross: D('0'),
      items: [
        {
          quantity: 1,
          lineListGross: D('1000'),
          lineSaleGross: D('1000'),
          lineSellerDiscountGross: D('0'),
          saleVatRate: 20,
          commissionGross: D('200'),
          refundedCommissionGross: D('0'),
          commissionVatRate: 20,
          unitCostSnapshotGross: D('300'),
          unitCostSnapshotVatRate: 20,
        },
      ],
      fees: [
        { feeType: 'SHIPPING', direction: 'DEBIT', amountGross: D('50'), vatRate: 20 },
        { feeType: 'PLATFORM_SERVICE', direction: 'DEBIT', amountGross: D('20'), vatRate: 20 },
        // Stopaj vatRate 0 → Net KDV'ye girmez, ayrı düşülür.
        { feeType: 'STOPPAGE', direction: 'DEBIT', amountGross: D('30'), vatRate: 0 },
      ],
      netProfit: D('300'),
      netVat: D('100'),
      saleMarginPct: D('30'),
      costMarkupPct: D('100'),
    });
    expect(v.stoppage).toBe('30.00');

    // Σ düşülen terimler + Net KDV = saleGross − netProfit (stopaj tam olarak BİR kez sayılır).
    const sumOfDeductions = new Decimal(v.costGross)
      .add(v.commissionGross)
      .add(v.shippingGross)
      .add(v.platformServiceGross)
      .add(v.stoppage)
      .add(v.netVat);
    expect(sumOfDeductions.toFixed(2)).toBe(
      new Decimal(v.saleGross).sub(v.netProfit).toFixed(2),
    );
    // 300 + 200 + 50 + 20 + 30 + 100 = 700 = 1000 − 300.
    expect(sumOfDeductions.toFixed(2)).toBe('700.00');
  });

  it('null margin renders dash', () => {
    const v = buildProfitBreakdown({
      saleGross: D('0'),
      saleVat: D('0'),
      listGross: D('0'),
      sellerDiscountGross: D('0'),
      items: [],
      fees: [],
      netProfit: D('0'),
      netVat: D('0'),
      saleMarginPct: null,
      costMarkupPct: null,
    });
    expect(v.saleMarginPct).toBe('—');
    expect(v.costMarkupPct).toBe('—');
  });

  it('effective commission = commissionGross - refundedCommissionGross', () => {
    const v = buildProfitBreakdown({
      saleGross: D('1200'),
      saleVat: D('200'),
      listGross: D('1200'),
      sellerDiscountGross: D('0'),
      items: [
        {
          quantity: 1,
          lineListGross: D('1200'),
          lineSaleGross: D('1200'),
          lineSellerDiscountGross: D('0'),
          saleVatRate: 20,
          commissionGross: D('200'),
          refundedCommissionGross: D('50'),
          commissionVatRate: 20,
          unitCostSnapshotGross: null,
          unitCostSnapshotVatRate: 0,
        },
      ],
      fees: [],
      netProfit: D('0'),
      netVat: D('0'),
      saleMarginPct: null,
      costMarkupPct: null,
    });
    // effectiveCommission = 200 - 50 = 150; VAT derived: 150 × 20/120 = 25
    expect(v.commissionGross).toBe('150.00');
    expect(v.commissionVat).toBe('25.00');
  });

  it('null cost snapshot contributes zero (does not throw)', () => {
    const v = buildProfitBreakdown({
      saleGross: D('100'),
      saleVat: D('20'),
      listGross: D('100'),
      sellerDiscountGross: D('0'),
      items: [
        {
          quantity: 3,
          lineListGross: null,
          lineSaleGross: null,
          lineSellerDiscountGross: null,
          saleVatRate: 20,
          commissionGross: D('0'),
          refundedCommissionGross: D('0'),
          commissionVatRate: 20,
          unitCostSnapshotGross: null,
          unitCostSnapshotVatRate: 0,
        },
      ],
      fees: [],
      netProfit: D('0'),
      netVat: D('0'),
      saleMarginPct: null,
      costMarkupPct: null,
    });
    expect(v.costGross).toBe('0.00');
    expect(v.costVat).toBe('0.00');
  });

  it('CREDIT fee is direction-signed (negative contribution)', () => {
    const v = buildProfitBreakdown({
      saleGross: D('500'),
      saleVat: D('100'),
      listGross: D('500'),
      sellerDiscountGross: D('0'),
      items: [],
      fees: [
        { feeType: 'SHIPPING', direction: 'DEBIT', amountGross: D('100'), vatRate: 20 },
        { feeType: 'SHIPPING', direction: 'CREDIT', amountGross: D('40'), vatRate: 20 },
      ],
      netProfit: D('0'),
      netVat: D('0'),
      saleMarginPct: null,
      costMarkupPct: null,
    });
    // DEBIT 100 - CREDIT 40 = net 60 signed gross
    expect(v.shippingGross).toBe('60.00');
  });

  it('VAT derived from gross × rate/(100+rate)', () => {
    const v = buildProfitBreakdown({
      saleGross: D('120'),
      saleVat: D('20'),
      listGross: D('120'),
      sellerDiscountGross: D('0'),
      items: [
        {
          quantity: 1,
          lineListGross: D('120'),
          lineSaleGross: D('120'),
          lineSellerDiscountGross: D('0'),
          saleVatRate: 20,
          commissionGross: D('0'),
          refundedCommissionGross: D('0'),
          commissionVatRate: 20,
          // cost 60 gross at 20% VAT → VAT = 60 × 20/120 = 10
          unitCostSnapshotGross: D('60'),
          unitCostSnapshotVatRate: 20,
        },
      ],
      fees: [],
      netProfit: D('0'),
      netVat: D('0'),
      saleMarginPct: null,
      costMarkupPct: null,
    });
    expect(v.costGross).toBe('60.00');
    expect(v.costVat).toBe('10.00'); // 60 × 20/120 = 10
  });
});
