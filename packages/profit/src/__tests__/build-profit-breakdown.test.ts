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
      fees: [
        {
          feeType: 'SHIPPING',
          direction: 'DEBIT',
          amountGross: D('10'),
          vatRate: 20,
          source: 'ESTIMATE',
        },
      ],
      netProfit: D('56'),
      netVat: D('14'),
      saleMarginPct: D('28'),
      costMarkupPct: D('56'),
    });
    expect(v.saleGross).toBe('200.00');
    expect(v.costGross).toBe('60.00'); // 30 × 2
    expect(v.shippingGross).toBe('10.00');
    // İade yok → outbound == toplam, return == 0 (frontend düz "Kargo" satırı çizer).
    expect(v.outboundShippingGross).toBe('10.00');
    expect(v.returnShippingGross).toBe('0.00');
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
        {
          feeType: 'SHIPPING',
          direction: 'DEBIT',
          amountGross: D('50'),
          vatRate: 20,
          source: 'ESTIMATE',
        },
        {
          feeType: 'PLATFORM_SERVICE',
          direction: 'DEBIT',
          amountGross: D('20'),
          vatRate: 20,
          source: 'ESTIMATE',
        },
        // Stopaj vatRate 0 → Net KDV'ye girmez, ayrı düşülür.
        {
          feeType: 'STOPPAGE',
          direction: 'DEBIT',
          amountGross: D('30'),
          vatRate: 0,
          source: 'ESTIMATE',
        },
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
    expect(sumOfDeductions.toFixed(2)).toBe(new Decimal(v.saleGross).sub(v.netProfit).toFixed(2));
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
        {
          feeType: 'SHIPPING',
          direction: 'DEBIT',
          amountGross: D('100'),
          vatRate: 20,
          source: 'ESTIMATE',
        },
        {
          feeType: 'SHIPPING',
          direction: 'CREDIT',
          amountGross: D('40'),
          vatRate: 20,
          source: 'ESTIMATE',
        },
      ],
      netProfit: D('0'),
      netVat: D('0'),
      saleMarginPct: null,
      costMarkupPct: null,
    });
    // DEBIT 100 - CREDIT 40 = net 60 signed gross
    expect(v.shippingGross).toBe('60.00');
  });

  it('full-return: netted display shows 0 sale/cost/commission, combined shipping', () => {
    // Senaryo: tam iade. Satici kargo vadeli 155.99 (ESTIMATE) + iade kargosu
    // 155.99 (CARGO_INVOICE). Satis hakediş REFUND_DEDUCTION (SETTLEMENT) ile
    // tam silinir. Komisyon COMMISSION_REFUND (SETTLEMENT) ile tam silinir.
    // Maliyet COST_RETURN (SETTLEMENT) ile tam silinir.
    //
    // Satis gross 2361.71, vatRate %10 → VAT = 2361.71 * 10/110 = 214.70090...
    // REFUND_DEDUCTION gross 2361.71, vatRate %10 → ayni VAT → dispSaleGross = 0.00
    //
    // Gorunum beklentisi:
    //   saleGross        = '0.00'
    //   costGross        = '0.00'
    //   commissionGross  = '0.00'
    //   shippingGross    = '311.98'  (155.99 ileri + 155.99 iade)
    const saleGross = D('2361.71');
    const saleVatRate = 10;
    const saleVat = saleGross.mul(saleVatRate).div(new Decimal(100).add(saleVatRate));
    const commissionGross = D('558.16');
    const costGross = D('800.00');

    const v = buildProfitBreakdown({
      saleGross,
      saleVat,
      listGross: D('2361.71'),
      sellerDiscountGross: D('0'),
      items: [
        {
          quantity: 1,
          lineListGross: D('2361.71'),
          lineSaleGross: D('2361.71'),
          lineSellerDiscountGross: D('0'),
          saleVatRate,
          commissionGross,
          refundedCommissionGross: D('0'),
          commissionVatRate: 20,
          unitCostSnapshotGross: costGross,
          unitCostSnapshotVatRate: 18,
        },
      ],
      fees: [
        // Ileri kargo — tahmin (ESTIMATE)
        {
          feeType: 'SHIPPING',
          direction: 'DEBIT',
          amountGross: D('155.99'),
          vatRate: 20,
          source: 'ESTIMATE',
        },
        // Iade kargosu — gercek fatura (CARGO_INVOICE); resolveReturnLegs bunu tercih eder
        {
          feeType: 'RETURN_SHIPPING',
          direction: 'DEBIT',
          amountGross: D('155.99'),
          vatRate: 20,
          source: 'CARGO_INVOICE',
        },
        // Satis iadesi — hakediş (SETTLEMENT)
        {
          feeType: 'REFUND_DEDUCTION',
          direction: 'CREDIT',
          amountGross: D('2361.71'),
          vatRate: 10,
          source: 'SETTLEMENT',
        },
        // Komisyon iadesi — hakediş (SETTLEMENT)
        {
          feeType: 'COMMISSION_REFUND',
          direction: 'CREDIT',
          amountGross: commissionGross,
          vatRate: 20,
          source: 'SETTLEMENT',
        },
        // Maliyet iadesi — hakediş (SETTLEMENT)
        {
          feeType: 'COST_RETURN',
          direction: 'CREDIT',
          amountGross: costGross,
          vatRate: 18,
          source: 'SETTLEMENT',
        },
      ],
      // netProfit/netVat zaten motor tarafindan dogru hesaplandi; burada display test
      netProfit: D('0'),
      netVat: D('0'),
      saleMarginPct: null,
      costMarkupPct: null,
    });

    expect(v.saleGross).toBe('0.00');
    expect(v.costGross).toBe('0.00');
    expect(v.commissionGross).toBe('0.00');
    expect(v.shippingGross).toBe('311.98'); // 155.99 + 155.99
    // YENİ: toplam korunur, gidiş/iade bileşenleri ayrı servis edilir.
    expect(v.outboundShippingGross).toBe('155.99'); // forward SHIPPING (ESTIMATE)
    expect(v.returnShippingGross).toBe('155.99'); // RETURN_SHIPPING (CARGO_INVOICE)
    // Bileşen toplamı = toplam (backend invariant; frontend türetmez).
    expect(new Decimal(v.outboundShippingGross).add(v.returnShippingGross).toFixed(2)).toBe(
      v.shippingGross,
    );
    expect(new Decimal(v.outboundShippingVat).add(v.returnShippingVat).toFixed(2)).toBe(
      v.shippingVat,
    );
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
