import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { buildProfitBreakdown } from '../build-profit-breakdown';

const D = (v: string): Decimal => new Decimal(v);

describe('buildProfitBreakdown', () => {
  // Gerçek stage siparişi 569592424 (qty2 × 2 kalem, kargolu) — panel + Berkin'in
  // otoritatif formülüyle empirik doğrulanmış sayılar. Brüt (KDV-dahil) toplamlar +
  // Net KDV kırılımı tam tutmalı.
  it('builds gross terms + VAT split matching the authoritative formula', () => {
    const view = buildProfitBreakdown({
      saleSubtotalNet: D('2750'),
      saleVatTotal: D('550'),
      items: [
        {
          quantity: 2,
          unitCostSnapshotNet: D('300'),
          unitCostSnapshotVatAmount: D('60'),
          grossCommissionAmountNet: D('500'),
          grossCommissionVatAmount: D('100'),
          refundedCommissionAmountNet: D('0'),
          refundedCommissionVatAmount: D('0'),
        },
        {
          quantity: 2,
          unitCostSnapshotNet: D('300'),
          unitCostSnapshotVatAmount: D('60'),
          grossCommissionAmountNet: D('50'),
          grossCommissionVatAmount: D('10'),
          refundedCommissionAmountNet: D('0'),
          refundedCommissionVatAmount: D('0'),
        },
      ],
      fees: [
        { feeType: 'SHIPPING', direction: 'DEBIT', amountNet: D('112.77'), vatAmount: D('22.55') },
        {
          feeType: 'PLATFORM_SERVICE',
          direction: 'DEBIT',
          amountNet: D('10.99'),
          vatAmount: D('2.20'),
        },
        { feeType: 'STOPPAGE', direction: 'DEBIT', amountNet: D('27.50'), vatAmount: D('0') },
      ],
      netProfit: D('848.74'),
      netVat: D('175.25'),
    });

    // Satış: net 2750 + KDV 550 = brüt 3300.
    expect(view.saleGross).toBe('3300.00');
    expect(view.saleVat).toBe('550.00');
    // Maliyet: (300+60)×2×2 = brüt 1440, KDV 240.
    expect(view.costGross).toBe('1440.00');
    expect(view.costVat).toBe('240.00');
    // Etkin komisyon (line-total, ×qty YAPILMAZ): (500+100)+(50+10) = 660, KDV 110.
    expect(view.commissionGross).toBe('660.00');
    expect(view.commissionVat).toBe('110.00');
    // Kargo: 112.77+22.55 = 135.32.
    expect(view.shippingGross).toBe('135.32');
    expect(view.shippingVat).toBe('22.55');
    // PSF: 10.99+2.20 = 13.19.
    expect(view.platformServiceGross).toBe('13.19');
    expect(view.platformServiceVat).toBe('2.20');
    // Stopaj KDV-siz.
    expect(view.stoppageNet).toBe('27.50');
    // Net KDV = 550 − 240 − 110 − 22.55 − 2.20 = 175.25 (persist'ten, doğrula).
    expect(view.netVat).toBe('175.25');
    expect(view.netProfit).toBe('848.74');
    // İndirim yok → sellerDiscountGross '0.00', listGross = saleGross.
    expect(view.sellerDiscountGross).toBe('0.00');
    expect(view.listGross).toBe('3300.00');

    // Çapraz kontrol: brüt − Net KDV zinciri persist netProfit'i vermeli.
    const sum = D(view.saleGross)
      .sub(view.costGross)
      .sub(view.commissionGross)
      .sub(view.shippingGross)
      .sub(view.platformServiceGross)
      .sub(view.stoppageNet)
      .sub(view.netVat);
    expect(sum.toFixed(2)).toBe(view.netProfit);
  });

  it('refunded commission lowers effective commission; missing fee types → 0', () => {
    const view = buildProfitBreakdown({
      saleSubtotalNet: D('1000'),
      saleVatTotal: D('200'),
      items: [
        {
          quantity: 1,
          unitCostSnapshotNet: D('0'),
          unitCostSnapshotVatAmount: D('0'),
          grossCommissionAmountNet: D('200'),
          grossCommissionVatAmount: D('40'),
          refundedCommissionAmountNet: D('50'),
          refundedCommissionVatAmount: D('10'),
        },
      ],
      fees: [
        {
          feeType: 'PLATFORM_SERVICE',
          direction: 'DEBIT',
          amountNet: D('10.99'),
          vatAmount: D('2.20'),
        },
      ],
      netProfit: D('1'),
      netVat: D('2'),
    });

    // Etkin komisyon = (200−50)+(40−10) = 150+30 = brüt 180, KDV 30.
    expect(view.commissionGross).toBe('180.00');
    expect(view.commissionVat).toBe('30.00');
    // Kargo + stopaj fee yok → 0.
    expect(view.shippingGross).toBe('0.00');
    expect(view.stoppageNet).toBe('0.00');
  });

  it('null cost snapshot contributes zero (does not throw)', () => {
    const view = buildProfitBreakdown({
      saleSubtotalNet: D('100'),
      saleVatTotal: D('20'),
      items: [
        {
          quantity: 3,
          unitCostSnapshotNet: null,
          unitCostSnapshotVatAmount: null,
          grossCommissionAmountNet: D('10'),
          grossCommissionVatAmount: D('2'),
          refundedCommissionAmountNet: D('0'),
          refundedCommissionVatAmount: D('0'),
        },
      ],
      fees: [],
      netProfit: D('0'),
      netVat: D('0'),
    });
    expect(view.costGross).toBe('0.00');
    expect(view.costVat).toBe('0.00');
  });

  it('only sums DEBIT fees of the three known types (CREDIT + other types excluded)', () => {
    const view = buildProfitBreakdown({
      saleSubtotalNet: D('1000'),
      saleVatTotal: D('200'),
      items: [
        {
          quantity: 1,
          unitCostSnapshotNet: D('0'),
          unitCostSnapshotVatAmount: D('0'),
          grossCommissionAmountNet: D('0'),
          grossCommissionVatAmount: D('0'),
          refundedCommissionAmountNet: D('0'),
          refundedCommissionVatAmount: D('0'),
        },
      ],
      fees: [
        // DEBIT bilinen tip → kovaya girer.
        { feeType: 'SHIPPING', direction: 'DEBIT', amountNet: D('100'), vatAmount: D('20') },
        // CREDIT aynı tip → yön-bilinçli olarak HARİÇ (sessizce düşülen gösterilmesin).
        { feeType: 'SHIPPING', direction: 'CREDIT', amountNet: D('999'), vatAmount: D('0') },
        // Kovalanmayan tip → dökümde satırı yok, HARİÇ.
        { feeType: 'ADVERTISING', direction: 'DEBIT', amountNet: D('777'), vatAmount: D('0') },
      ],
      netProfit: D('880'),
      netVat: D('180'),
    });
    // Yalnız DEBIT SHIPPING 100+20 = 120; CREDIT 999 ve ADVERTISING 777 girmedi.
    expect(view.shippingGross).toBe('120.00');
  });

  it('seller discount: listGross = net satış + indirim; sellerDiscountGross line-total toplanır', () => {
    const view = buildProfitBreakdown({
      saleSubtotalNet: D('1000'), // effectiveSale net (liste − indirim, zaten düşülmüş)
      saleVatTotal: D('200'), // → saleGross 1200
      items: [
        {
          quantity: 1,
          unitCostSnapshotNet: D('0'),
          unitCostSnapshotVatAmount: D('0'),
          grossCommissionAmountNet: D('0'),
          grossCommissionVatAmount: D('0'),
          refundedCommissionAmountNet: D('0'),
          refundedCommissionVatAmount: D('0'),
          sellerDiscountNet: D('150'),
          sellerDiscountVatAmount: D('30'), // indirim brüt 180
        },
      ],
      fees: [],
      netProfit: D('0'),
      netVat: D('0'),
    });
    expect(view.saleGross).toBe('1200.00'); // net satış (effectiveSale) brüt
    expect(view.sellerDiscountGross).toBe('180.00'); // 150 + 30
    expect(view.listGross).toBe('1380.00'); // 1200 + 180 = liste fiyatı brüt
  });
});
