import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { sellerEffectivePrice, type DiscountConfig } from '@/services/discount-math-commons';

const NET_10_PCT: DiscountConfig = {
  type: 'NET',
  valueKind: 'PERCENT',
  value: new Decimal(10),
};
const NET_100_TL: DiscountConfig = {
  type: 'NET',
  valueKind: 'AMOUNT',
  value: new Decimal(100),
};

describe('sellerEffectivePrice', () => {
  it('karşılama 0 iken effectiveUnitPrice ile aynı sonucu verir', () => {
    const s = sellerEffectivePrice(new Decimal(1000), NET_10_PCT, new Decimal(0));
    expect(s.toFixed(2)).toBe('900.00');
  });

  it('Berkin senaryosu: 1000 TL, 100 TL indirim, %60 karşılama → 960', () => {
    const s = sellerEffectivePrice(new Decimal(1000), NET_100_TL, new Decimal(60));
    expect(s.toFixed(2)).toBe('960.00');
  });

  it('yüzde indirimde de karşılama payı düşülür', () => {
    const s = sellerEffectivePrice(new Decimal(1000), NET_10_PCT, new Decimal(60));
    expect(s.toFixed(2)).toBe('960.00');
  });

  it('karşılama %100 iken satıcı hiç indirim üstlenmez', () => {
    const s = sellerEffectivePrice(new Decimal(1000), NET_10_PCT, new Decimal(100));
    expect(s.toFixed(2)).toBe('1000.00');
  });

  it('indirim fiyatı aşarsa taban 0 üzerinden hesaplanır', () => {
    const config: DiscountConfig = {
      type: 'NET',
      valueKind: 'AMOUNT',
      value: new Decimal(2000),
    };
    // effectiveUnitPrice = 0 → D = 1000 → S = 1000 − 1000 × 0,40 = 600
    const s = sellerEffectivePrice(new Decimal(1000), config, new Decimal(60));
    expect(s.toFixed(2)).toBe('600.00');
  });

  it('X Al Y Öde: 3 al 2 öde, 300 TL, %50 karşılama', () => {
    const config: DiscountConfig = { type: 'BUY_X_PAY_Y', buyQuantity: 3, payQuantity: 2 };
    // effectiveUnitPrice = 300 × 2/3 = 200 → D = 100 → S = 300 − 50 = 250
    const s = sellerEffectivePrice(new Decimal(300), config, new Decimal(50));
    expect(s.toFixed(2)).toBe('250.00');
  });

  it('sepet-tutar kurgusunda indirim varsayılan adete bölünür', () => {
    const config: DiscountConfig = {
      type: 'CONDITIONAL_BASKET',
      valueKind: 'AMOUNT',
      value: new Decimal(100),
      minBasketAmount: new Decimal(1000),
    };
    // n = ceil(1000/250) = 4 → D = 25 → S = 250 − 25 × 0,40 = 240
    const s = sellerEffectivePrice(new Decimal(250), config, new Decimal(60));
    expect(s.toFixed(2)).toBe('240.00');
  });

  it('fiyat sıfır ya da negatifse sıfır döner', () => {
    expect(sellerEffectivePrice(new Decimal(0), NET_10_PCT, new Decimal(60)).toFixed(2)).toBe(
      '0.00',
    );
  });

  it('karşılama oranı [0, 100] aralığına kırpılır', () => {
    const over = sellerEffectivePrice(new Decimal(1000), NET_10_PCT, new Decimal(150));
    expect(over.toFixed(2)).toBe('1000.00');
    const under = sellerEffectivePrice(new Decimal(1000), NET_10_PCT, new Decimal(-20));
    expect(under.toFixed(2)).toBe('900.00');
  });
});
