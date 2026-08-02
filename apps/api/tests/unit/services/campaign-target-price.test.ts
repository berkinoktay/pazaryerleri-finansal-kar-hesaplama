import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  sellerEffectivePrice,
  solveCampaignPriceForTarget,
  type DiscountConfig,
} from '@/services/discount-math-commons';

const NET_10_PCT: DiscountConfig = {
  type: 'NET',
  valueKind: 'PERCENT',
  value: new Decimal(10),
};

const BASKET_100_TL: DiscountConfig = {
  type: 'CONDITIONAL_BASKET',
  valueKind: 'AMOUNT',
  value: new Decimal(100),
  minBasketAmount: new Decimal(1000),
};

describe('solveCampaignPriceForTarget', () => {
  it('net yüzde indirimde kapalı formu birebir tutturur', () => {
    // S = P × (1 − 0,10 × 0,40) = P × 0,96 → hedef 960 için P = 1000
    const p = solveCampaignPriceForTarget(
      NET_10_PCT,
      new Decimal(60),
      new Decimal(960),
      new Decimal(2000),
    );
    expect(p).not.toBeNull();
    expect(p?.toFixed(2)).toBe('1000.00');
  });

  it('bulunan fiyat hedefi GERÇEKTEN sağlar (yuvarlama yukarı)', () => {
    const target = new Decimal('333.33');
    const p = solveCampaignPriceForTarget(NET_10_PCT, new Decimal(0), target, new Decimal(2000));
    expect(p).not.toBeNull();
    expect(sellerEffectivePrice(p as Decimal, NET_10_PCT, new Decimal(0)).gte(target)).toBe(true);
  });

  it('maksimum fiyatta bile hedefe ulaşılamıyorsa null döner', () => {
    const p = solveCampaignPriceForTarget(
      NET_10_PCT,
      new Decimal(0),
      new Decimal(5000),
      new Decimal(1000),
    );
    expect(p).toBeNull();
  });

  it('sepet-tutar kurgusundaki ceil sıçramasında EN KÜÇÜK geçerli fiyatı bulur', () => {
    // Hedef 308: P = 333 → n = 4 → S = 308 (tam tutar). P = 334 → n = 3 → S = 300,67 (tutmaz).
    // Monoton olmadığı için ikili arama 334'ü seçip hedefi kaçırırdı.
    const p = solveCampaignPriceForTarget(
      BASKET_100_TL,
      new Decimal(0),
      new Decimal(308),
      new Decimal(400),
    );
    expect(p).not.toBeNull();
    expect(p?.toFixed(2)).toBe('333.00');
    expect(sellerEffectivePrice(p as Decimal, BASKET_100_TL, new Decimal(0)).gte(308)).toBe(true);
  });

  it('sepet-tutar kurgusunda karşılama payı da hesaba katılır', () => {
    // n = 4 parçasında S = P − 25 × 0,40 = P − 10 → hedef 240 için P = 250. AMA n = 5
    // parçasında (P ∈ [200, 250)) S = P − 20 × 0,40 = P − 8 → hedef 240 için P = 248 — daha
    // küçük ve GEÇERLİ bir çözüm (n = 5'te 5 × 248 = 1240 ≥ 1000, sepet koşulu sağlanır).
    // Brute-force kuruş-taraması bunu doğruluyor: en küçük geçerli fiyat 248,00, 250,00
    // değil. Bu tam olarak görevin kendi gerekçesindeki monotonsuzluğun bir örneği — P = 249
    // için S = 241 iken P = 250'de S DÜŞER (240'a); çözücü n = 5 dalını atlarsa daha büyük
    // ama yanlış bir "en küçük" fiyat döner.
    const p = solveCampaignPriceForTarget(
      BASKET_100_TL,
      new Decimal(60),
      new Decimal(240),
      new Decimal(400),
    );
    expect(p?.toFixed(2)).toBe('248.00');
    expect(sellerEffectivePrice(p as Decimal, BASKET_100_TL, new Decimal(60)).gte(240)).toBe(true);
  });

  it('X. ürüne sabit fiyat kurgusunda kırılımın doğru tarafını seçer', () => {
    const config: DiscountConfig = {
      type: 'NTH_PRODUCT',
      valueKind: 'FIXED_PRICE',
      value: new Decimal(50),
      nthIndex: 2,
    };
    const target = new Decimal(180);
    const p = solveCampaignPriceForTarget(config, new Decimal(0), target, new Decimal(1000));
    expect(p).not.toBeNull();
    expect(sellerEffectivePrice(p as Decimal, config, new Decimal(0)).gte(target)).toBe(true);
  });

  it('maksimum fiyat sıfır ya da negatifse null döner', () => {
    const p = solveCampaignPriceForTarget(
      NET_10_PCT,
      new Decimal(0),
      new Decimal(10),
      new Decimal(0),
    );
    expect(p).toBeNull();
  });
});
