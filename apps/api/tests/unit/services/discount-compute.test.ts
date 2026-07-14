import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { effectiveUnitPrice, type DiscountConfig } from '@/services/discount-compute.service';

const d = (v: string | number): Decimal => new Decimal(v);
const price = (config: DiscountConfig, p: string | number): string =>
  effectiveUnitPrice(d(p), config).toDecimalPlaces(4).toString();

describe('effectiveUnitPrice', () => {
  it('NET amount subtracts, flooring at zero', () => {
    expect(price({ type: 'NET', valueKind: 'AMOUNT', value: d(50) }, 200)).toBe('150');
    expect(price({ type: 'NET', valueKind: 'AMOUNT', value: d(300) }, 200)).toBe('0');
  });

  it('NET percent scales the price', () => {
    expect(price({ type: 'NET', valueKind: 'PERCENT', value: d(20) }, 250)).toBe('200');
  });

  it('CONDITIONAL_BASKET amount splits over the minimum qualifying quantity', () => {
    // min sepet 1000, ürün 250 → n = ceil(1000/250) = 4 adet → birim pay 100/4 = 25.
    const cfg: DiscountConfig = {
      type: 'CONDITIONAL_BASKET',
      valueKind: 'AMOUNT',
      value: d(100),
      minBasketAmount: d(1000),
    };
    expect(price(cfg, 250)).toBe('225');
    // Ürün min sepeti tek başına aşıyorsa n=1 → indirim tamamen tek birime.
    expect(price(cfg, 1200)).toBe('1100');
  });

  it('CONDITIONAL_BASKET percent equals a flat percent per unit (proportional split)', () => {
    const cfg: DiscountConfig = {
      type: 'CONDITIONAL_BASKET',
      valueKind: 'PERCENT',
      value: d(20),
      minBasketAmount: d(1000),
    };
    expect(price(cfg, 250)).toBe('200');
  });

  it('CONDITIONAL_QUANTITY amount splits over N units, percent stays flat', () => {
    expect(
      price(
        { type: 'CONDITIONAL_QUANTITY', valueKind: 'AMOUNT', value: d(60), minQuantity: 3 },
        100,
      ),
    ).toBe('80');
    expect(
      price(
        { type: 'CONDITIONAL_QUANTITY', valueKind: 'PERCENT', value: d(10), minQuantity: 3 },
        100,
      ),
    ).toBe('90');
  });

  it('BUY_X_PAY_Y scales by payQuantity/buyQuantity', () => {
    expect(price({ type: 'BUY_X_PAY_Y', buyQuantity: 4, payQuantity: 2 }, 100)).toBe('50');
    expect(price({ type: 'BUY_X_PAY_Y', buyQuantity: 3, payQuantity: 2 }, 90)).toBe('60');
  });

  it('NTH_PRODUCT applies the discount to one unit of N', () => {
    // 3. ürüne %50: (2×100 + 50) / 3 = 83.3333
    expect(
      price({ type: 'NTH_PRODUCT', valueKind: 'PERCENT', value: d(50), nthIndex: 3 }, 100),
    ).toBe('83.3333');
    // 2. ürüne 30 TL indirim: (100 + 70) / 2 = 85; indirim fiyatı aşarsa birim 0'a taban.
    expect(
      price({ type: 'NTH_PRODUCT', valueKind: 'AMOUNT', value: d(30), nthIndex: 2 }, 100),
    ).toBe('85');
    expect(
      price({ type: 'NTH_PRODUCT', valueKind: 'AMOUNT', value: d(500), nthIndex: 2 }, 100),
    ).toBe('50');
    // 4. ürün 10 TL (sabit fiyat): (3×100 + 10) / 4 = 77.5
    expect(
      price({ type: 'NTH_PRODUCT', valueKind: 'FIXED_PRICE', value: d(10), nthIndex: 4 }, 100),
    ).toBe('77.5');
  });

  it('CODE behaves exactly like CONDITIONAL_BASKET', () => {
    expect(
      price({ type: 'CODE', valueKind: 'AMOUNT', value: d(100), minBasketAmount: d(1000) }, 250),
    ).toBe('225');
    expect(
      price({ type: 'CODE', valueKind: 'PERCENT', value: d(15), minBasketAmount: d(500) }, 200),
    ).toBe('170');
  });

  it('never returns a negative price and passes a zero price through', () => {
    expect(price({ type: 'NET', valueKind: 'PERCENT', value: d(100) }, 250)).toBe('0');
    expect(price({ type: 'NET', valueKind: 'AMOUNT', value: d(10) }, 0)).toBe('0');
    expect(
      price(
        {
          type: 'CONDITIONAL_BASKET',
          valueKind: 'AMOUNT',
          value: d(100),
          minBasketAmount: d(1000),
        },
        0,
      ),
    ).toBe('0');
  });
});
