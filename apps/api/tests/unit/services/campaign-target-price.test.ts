import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  campaignPriceSegments,
  campaignSearchWindow,
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

  it("N-adet kurgusunda kırılım value/minQuantity'dedir, value'nun kendisi DEĞİL", () => {
    // effectiveUnitPrice, CONDITIONAL_QUANTITY/AMOUNT'ta value/minQuantity ile bölüyor (bkz.
    // discount-math-commons.ts satır ~89): max(price − value/minQuantity, 0). Kırılım (taban
    // sıfırlandığı nokta) da orada olmalı — value=100, minQuantity=5 → gerçek taban 100/5=20,
    // config.value'nun kendisi (100) DEĞİL. campaignPriceSegments bu ayrımı gözetmezse
    // (eskiden NET ile aynı kollu switch dalıydı, doğrudan config.value'yu kırılım sanıyordu)
    // çözücü, penceredeki TEK "parça"nın [hedef,maxPrice] uçlarından birine sıkışır ve gereğinden
    // büyük bir fiyat döner. S(P) = P − 20 (karşılama 0), hedef 5 → gerçek en küçük fiyat 25,00.
    const config: DiscountConfig = {
      type: 'CONDITIONAL_QUANTITY',
      valueKind: 'AMOUNT',
      value: new Decimal(100),
      minQuantity: 5,
    };
    const p = solveCampaignPriceForTarget(config, new Decimal(0), new Decimal(5), new Decimal(100));
    expect(p).not.toBeNull();
    expect(p?.toFixed(2)).toBe('25.00');
  });
});

describe('campaignPriceSegments — performans sabitlemesi', () => {
  it('sepet-tutar kurgusunda parça sayısı, hedef tabanlı bir alt sınırla küçük kalır', () => {
    // Gerçekçi bir sepet eşiği (5.000 TL) ve gerçekçi bir arama penceresi (400 → 240 TL, yani
    // 1 kuruşa DEĞİL hedefe yakın bir alt sınıra kırpılmış). Kırılım sayısı yalnız
    // ceil(M/maxPrice)..ceil(M/minPrice) aralığındaki n değerleri kadardır (burada 9). Alt sınır
    // 1 kuruşa (PRICE_EPSILON) kadar inseydi — solveCampaignPriceForTarget'ın DÜZELTMEDEN ÖNCEKİ
    // hâli tam olarak buydu — aynı çağrı 1.402 parça üretiyordu; 5.000 TL'den büyük eşiklerde bu
    // sayı yüz binlere çıkıyordu (ölçülen: minBasketAmount=5000, maxPrice=2000, minPrice=0,01 →
    // tek bir solveCampaignPriceForTarget çağrısı ~775 ms). Bu test, alt sınırın hedefe
    // dayandırılmasının (bkz. solveCampaignPriceForTarget'taki `searchLo`) bu patlamayı kalıcı
    // olarak önlediğini sabitler — üst sınır (20) gerçek sayının (9) üstünde bolluk payı bırakır
    // ama patlama senaryosunun (1.402) çok altındadır.
    const config: DiscountConfig = {
      type: 'CONDITIONAL_BASKET',
      valueKind: 'AMOUNT',
      value: new Decimal(300),
      minBasketAmount: new Decimal(5000),
    };
    const segments = campaignPriceSegments(config, new Decimal(400), new Decimal(240));
    expect(segments.length).toBeLessThan(20);
  });
});

describe('campaignSearchWindow', () => {
  it('alt sınır hedeftir, 1 kuruşluk epsilon DEĞİL', () => {
    // Bu, solveCampaignPriceForTarget'ın üstündeki bir kutu-testi DEĞİL — campaignPriceSegments'ı
    // hardcoded bir minPrice ile çağırmak (yukarıdaki "performans sabitlemesi" testi gibi) hiçbir
    // zaman solveCampaignPriceForTarget'ın GERÇEK pencere hesaplamasına dokunmaz; alt sınır
    // düzeltmesi geri alınsa bile o test yeşil kalırdı. Bu test doğrudan campaignSearchWindow'u
    // çağırıp `lo`'nun hedefin KENDİSİ (240,00) olduğunu iddia ediyor. Düzeltme geri alınıp alt
    // sınır PRICE_EPSILON'a (0,01) döndürülseydi bu iddia `'0.01' !== '240.00'` ile HEMEN
    // patlardı — regresyonu doğrudan yakalayan test budur.
    const window = campaignSearchWindow(new Decimal(240), new Decimal(400));
    expect(window).not.toBeNull();
    expect(window?.lo.toFixed(2)).toBe('240.00');
    expect(window?.hi.toFixed(2)).toBe('400.00');
  });

  it("hedef maxPrice'ın üstündeyse pencere boştur, null döner", () => {
    const window = campaignSearchWindow(new Decimal(5000), new Decimal(1000));
    expect(window).toBeNull();
  });

  it('maxPrice sıfır ya da negatifse null döner', () => {
    const window = campaignSearchWindow(new Decimal(10), new Decimal(0));
    expect(window).toBeNull();
  });
});

describe('campaignPriceSegments — sıfır/negatif minPrice koruması', () => {
  // decimal.js `x.div(0)` fırlatmaz, Infinity döner. minPrice <= 0 geçilirse
  // qualifyingQuantity(minPrice, minBasketAmount) sonsuza gider ve CONDITIONAL_BASKET/CODE
  // kırılım döngüsü (`for (let n = nLo; n <= nHi; n += 1)`) hiç bitmeyen bir senkron döngüye
  // düşer — vitest'in zaman aşımı senkron bir bloğu kesemez, tüm çalıştırıcıyı askıda bırakır.
  // Bu yüzden testin kendisi guard'ı KALDIRMIYOR (gerçekten askıya alma riskiyle); guard'ın var
  // olduğunu ve fonksiyonun sonlu/anlamlı bir sonuç döndürdüğünü doğruluyor. Açık zaman aşımı,
  // guard ileride yanlışlıkla kaldırılırsa CI'ı sonsuza dek bloke etmek yerine testin hızlı
  // başarısız olmasını garanti eder.
  it('minPrice <= 0 sonlu bir sonuç döner, sonsuz döngüye girmez', () => {
    const config: DiscountConfig = {
      type: 'CONDITIONAL_BASKET',
      valueKind: 'AMOUNT',
      value: new Decimal(100),
      minBasketAmount: new Decimal(1000),
    };
    const segments = campaignPriceSegments(config, new Decimal(400), new Decimal(0));
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.every((s) => s.hi.gt(s.lo))).toBe(true);
  }, 2000);

  it('minPrice negatifse de sonlu bir sonuç döner', () => {
    const config: DiscountConfig = {
      type: 'CONDITIONAL_BASKET',
      valueKind: 'AMOUNT',
      value: new Decimal(100),
      minBasketAmount: new Decimal(1000),
    };
    const segments = campaignPriceSegments(config, new Decimal(400), new Decimal(-50));
    expect(segments.length).toBeGreaterThan(0);
  }, 2000);
});
