/**
 * Unit tests for `computeProfit()` — pure function, no DB required.
 * Verifies design §2 formula + edge cases.
 */

import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { computeProfit, type ProfitInputs } from '../profit-formula';

const D = (v: string | number) => new Decimal(v);

function emptyInput(overrides: Partial<ProfitInputs> = {}): ProfitInputs {
  return {
    saleSubtotalNet: D(0),
    saleVatTotal: D(0),
    items: [],
    fees: [],
    ...overrides,
  };
}

function defaultItem(overrides: Partial<ProfitInputs['items'][number]> = {}) {
  return {
    quantity: 1,
    unitCostSnapshotNet: D(0),
    unitCostSnapshotVatAmount: D(0),
    grossCommissionAmountNet: D(0),
    grossCommissionVatAmount: D(0),
    refundedCommissionAmountNet: D(0),
    refundedCommissionVatAmount: D(0),
    sellerDiscountNet: D(0),
    sellerDiscountVatAmount: D(0),
    ...overrides,
  };
}

describe('computeProfit() — design §2 formula', () => {
  it('empty input → zero profit', () => {
    const r = computeProfit(emptyInput());
    expect(r.netProfit.toString()).toBe('0');
    expect(r.netVat.toString()).toBe('0');
  });

  it('sale only (no costs, no fees) → profit equals saleSubtotalNet', () => {
    const r = computeProfit(emptyInput({ saleSubtotalNet: D('100'), saleVatTotal: D('20') }));
    expect(r.netProfit.toString()).toBe('100');
    expect(r.netVat.toString()).toBe('20');
  });

  it('happy path %20 VAT — design §2.2 example (100 net sale, 50 net cost, 10 net commission)', () => {
    // Satış: 100 net + 20 KDV = 120 brüt
    // Maliyet: 50 net + 10 KDV = 60 brüt (vatRate %20)
    // Komisyon: 10 net + 2 KDV = 12 brüt (vatRate %20)
    // Net profit = 100 − 50 − 10 = 40
    // Net VAT   = 20 − 10 − 2 = 8 (pass-through)
    const r = computeProfit({
      saleSubtotalNet: D('100'),
      saleVatTotal: D('20'),
      items: [
        defaultItem({
          unitCostSnapshotNet: D('50'),
          unitCostSnapshotVatAmount: D('10'),
          grossCommissionAmountNet: D('10'),
          grossCommissionVatAmount: D('2'),
        }),
      ],
      fees: [],
    });
    expect(r.netProfit.toString()).toBe('40');
    expect(r.netVat.toString()).toBe('8');
  });

  it('effective commission = gross − refunded (design §3.2 Discount handling)', () => {
    // Gross commission 20, refunded 5 → effective 15. Cost 0, sale 100.
    // Net profit = 100 − 15 = 85
    const r = computeProfit({
      saleSubtotalNet: D('100'),
      saleVatTotal: D('20'),
      items: [
        defaultItem({
          grossCommissionAmountNet: D('20'),
          grossCommissionVatAmount: D('4'),
          refundedCommissionAmountNet: D('5'),
          refundedCommissionVatAmount: D('1'),
        }),
      ],
      fees: [],
    });
    expect(r.netProfit.toString()).toBe('85');
    expect(r.netVat.toString()).toBe('17'); // 20 − (4 − 1) = 17
  });

  it('seller discount reduces profit (gerçek gelir azaltıcı)', () => {
    const r = computeProfit({
      saleSubtotalNet: D('100'),
      saleVatTotal: D('20'),
      items: [
        defaultItem({
          sellerDiscountNet: D('10'),
          sellerDiscountVatAmount: D('2'),
        }),
      ],
      fees: [],
    });
    expect(r.netProfit.toString()).toBe('90'); // 100 − 10
    expect(r.netVat.toString()).toBe('18'); // 20 − 2
  });

  it('DEBIT fees subtract from profit (PSF / Stopaj / Shipping)', () => {
    const r = computeProfit({
      saleSubtotalNet: D('100'),
      saleVatTotal: D('20'),
      items: [defaultItem()],
      fees: [
        { amountNet: D('10.99'), vatAmount: D('2.20'), direction: 'DEBIT' }, // PSF
        { amountNet: D('1.00'), vatAmount: D('0.00'), direction: 'DEBIT' }, // Stopaj %1
        { amountNet: D('25.00'), vatAmount: D('5.00'), direction: 'DEBIT' }, // Shipping
      ],
    });
    // 100 − (10.99 + 1 + 25) = 63.01
    expect(r.netProfit.toString()).toBe('63.01');
    // 20 − (2.20 + 0 + 5) = 12.80
    expect(r.netVat.toString()).toBe('12.8');
  });

  it('CREDIT fees add to profit (komisyon iadesi / SellerRevenuePositive)', () => {
    const r = computeProfit({
      saleSubtotalNet: D('100'),
      saleVatTotal: D('20'),
      items: [defaultItem()],
      fees: [
        { amountNet: D('30'), vatAmount: D('6'), direction: 'DEBIT' },
        { amountNet: D('5'), vatAmount: D('1'), direction: 'CREDIT' }, // komisyon iadesi
      ],
    });
    expect(r.netProfit.toString()).toBe('75'); // 100 − 30 + 5
    expect(r.netVat.toString()).toBe('15'); // 20 − 6 + 1
  });

  it('quantity > 1 — item cost multiplied', () => {
    const r = computeProfit({
      saleSubtotalNet: D('200'), // 2 × 100
      saleVatTotal: D('40'),
      items: [
        defaultItem({
          quantity: 2,
          unitCostSnapshotNet: D('40'),
          unitCostSnapshotVatAmount: D('8'),
        }),
      ],
      fees: [],
    });
    // Cost = 40 × 2 = 80; Profit = 200 − 80 = 120
    expect(r.netProfit.toString()).toBe('120');
    expect(r.netVat.toString()).toBe('24'); // 40 − 16
  });

  it('multi-item — different VAT rates aggregate correctly', () => {
    // Item 1: cost 50 net + 10 KDV %20 (qty 1)
    // Item 2: cost 100 net + 1 KDV %1 (qty 1)
    const r = computeProfit({
      saleSubtotalNet: D('300'),
      saleVatTotal: D('30'),
      items: [
        defaultItem({
          unitCostSnapshotNet: D('50'),
          unitCostSnapshotVatAmount: D('10'),
        }),
        defaultItem({
          unitCostSnapshotNet: D('100'),
          unitCostSnapshotVatAmount: D('1'),
        }),
      ],
      fees: [],
    });
    expect(r.netProfit.toString()).toBe('150'); // 300 − 150
    expect(r.netVat.toString()).toBe('19'); // 30 − 11
  });

  it('iade senaryosu — REFUND_DEDUCTION DEBIT + COMMISSION_REFUND CREDIT', () => {
    // Sale 100, commission 20 gross. İade gelirse:
    //   - REFUND_DEDUCTION DEBIT 100 (sale geri alımı)
    //   - COMMISSION_REFUND CREDIT 20 (komisyon iadesi)
    // Net etki: profit = 100 − 20 (orig commission) − 100 (refund) + 20 (refund commission) = 0
    const r = computeProfit({
      saleSubtotalNet: D('100'),
      saleVatTotal: D('20'),
      items: [
        defaultItem({
          grossCommissionAmountNet: D('20'),
          grossCommissionVatAmount: D('4'),
        }),
      ],
      fees: [
        { amountNet: D('100'), vatAmount: D('20'), direction: 'DEBIT' }, // REFUND_DEDUCTION
        { amountNet: D('20'), vatAmount: D('4'), direction: 'CREDIT' }, // COMMISSION_REFUND
      ],
    });
    expect(r.netProfit.toString()).toBe('0');
    expect(r.netVat.toString()).toBe('0');
  });

  it('Decimal precision — %1 VAT edge case (Stopaj scenario)', () => {
    // saleSubtotalNet = 99.87 → stopaj = 0.9987 → ROUND(0.9987, 2) = 1.00
    // (Bu computeProfit içinde değil, çağıran applyEstimate'te yapılır;
    //  burada sadece feeAmount kullanılır)
    const r = computeProfit({
      saleSubtotalNet: D('99.87'),
      saleVatTotal: D('19.97'),
      items: [defaultItem()],
      fees: [{ amountNet: D('1.00'), vatAmount: D('0'), direction: 'DEBIT' }],
    });
    expect(r.netProfit.toString()).toBe('98.87');
  });

  it('breakdown — gross display values correct', () => {
    const r = computeProfit({
      saleSubtotalNet: D('100'),
      saleVatTotal: D('20'),
      items: [
        defaultItem({
          unitCostSnapshotNet: D('50'),
          unitCostSnapshotVatAmount: D('10'),
          grossCommissionAmountNet: D('10'),
          grossCommissionVatAmount: D('2'),
        }),
      ],
      fees: [{ amountNet: D('5'), vatAmount: D('1'), direction: 'DEBIT' }],
    });
    expect(r.breakdown.saleGross.toString()).toBe('120');
    expect(r.breakdown.itemCostGross.toString()).toBe('60');
    expect(r.breakdown.commissionGross.toString()).toBe('12');
    expect(r.breakdown.debitFeesGross.toString()).toBe('6');
    expect(r.breakdown.creditFeesGross.toString()).toBe('0');
  });
});
