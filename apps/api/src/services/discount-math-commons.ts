// Tür-bağımsız indirim matematiği — İndirimler (satıcının kurduğu indirimler) ve
// Kampanyalar (Trendyol'un kurduğu kampanyalar) dikeylerinin ORTAK çekirdeği.
//
// Terfi gerekçesi (CLAUDE.md, WET+1): bu semboller 2026-07'de yalnız İndirimler'in
// compute servisinde yaşıyordu; Kampanyalar ikinci tüketici olarak devreye girince
// tek gerçek kaynağa çekildiler. Buradaki hiçbir fonksiyon veritabanı ya da entity
// import etmez — yalnız decimal.js ve komisyon bandı tipi.
//
// Kampanyalar'ın eklediği tek kavram `sellerEffectivePrice`: Trendyol'un karşıladığı
// indirim payı düşüldükten sonra satıcının HAKEDİŞİNE esas satış tutarı. İndirimler bu
// fonksiyonu karşılama oranı 0 ile çağırır ve sonuç `effectiveUnitPrice` ile birebir
// aynı olur — terfi davranış değiştirmez.

import { Decimal } from 'decimal.js';

import { bandForPrice } from './commission-tariff-compute.service';
import type { StoredBand } from './commission-tariff.types';

export type DiscountConfig =
  | { readonly type: 'NET'; readonly valueKind: 'AMOUNT' | 'PERCENT'; readonly value: Decimal }
  | {
      readonly type: 'CONDITIONAL_BASKET';
      readonly valueKind: 'AMOUNT' | 'PERCENT';
      readonly value: Decimal;
      readonly minBasketAmount: Decimal;
    }
  | {
      readonly type: 'CONDITIONAL_QUANTITY';
      readonly valueKind: 'AMOUNT' | 'PERCENT';
      readonly value: Decimal;
      readonly minQuantity: number;
    }
  | { readonly type: 'BUY_X_PAY_Y'; readonly buyQuantity: number; readonly payQuantity: number }
  | {
      readonly type: 'NTH_PRODUCT';
      readonly valueKind: 'AMOUNT' | 'PERCENT' | 'FIXED_PRICE';
      readonly value: Decimal;
      readonly nthIndex: number;
    }
  | {
      readonly type: 'CODE';
      readonly valueKind: 'AMOUNT' | 'PERCENT';
      readonly value: Decimal;
      readonly minBasketAmount: Decimal;
    };

const ZERO = new Decimal(0);
const HUNDRED = new Decimal(100);

/** price × (1 − pct/100), floored at 0. */
function applyPercent(price: Decimal, pct: Decimal): Decimal {
  return Decimal.max(price.mul(Decimal.sub(1, pct.div(HUNDRED))), ZERO);
}

/** price − amount, floored at 0. */
function applyAmount(price: Decimal, amount: Decimal): Decimal {
  return Decimal.max(price.sub(amount), ZERO);
}

/**
 * The minimum quantity of THIS product whose single-product basket satisfies the
 * min-basket condition. A zero/negative price cannot qualify — the caller guards.
 */
function qualifyingQuantity(price: Decimal, minBasketAmount: Decimal): number {
  return Math.max(minBasketAmount.div(price).ceil().toNumber(), 1);
}

/**
 * Per-unit effective selling price under the single-product-basket assumption
 * (design §5.1). Full-precision Decimal — serialization rounds at the DTO edge.
 */
export function effectiveUnitPrice(price: Decimal, config: DiscountConfig): Decimal {
  if (price.lte(ZERO)) return ZERO;

  switch (config.type) {
    case 'NET':
      return config.valueKind === 'PERCENT'
        ? applyPercent(price, config.value)
        : applyAmount(price, config.value);
    case 'CONDITIONAL_BASKET':
    case 'CODE': {
      if (config.valueKind === 'PERCENT') return applyPercent(price, config.value);
      const n = qualifyingQuantity(price, config.minBasketAmount);
      return applyAmount(price, config.value.div(n));
    }
    case 'CONDITIONAL_QUANTITY':
      return config.valueKind === 'PERCENT'
        ? applyPercent(price, config.value)
        : applyAmount(price, config.value.div(Math.max(config.minQuantity, 1)));
    case 'BUY_X_PAY_Y':
      return price.mul(config.payQuantity).div(config.buyQuantity);
    case 'NTH_PRODUCT': {
      const n = Math.max(config.nthIndex, 1);
      const discountedUnit =
        config.valueKind === 'PERCENT'
          ? applyPercent(price, config.value)
          : config.valueKind === 'AMOUNT'
            ? applyAmount(price, config.value)
            : // FIXED_PRICE — floored at 0 and CLAMPED to the current price: a fixed price above
              // the current price must not RAISE the effective unit (a discount never increases
              // the price; this also kills a negative perOrderCost).
              Decimal.min(price, Decimal.max(config.value, ZERO));
      return price
        .mul(n - 1)
        .add(discountedUnit)
        .div(n);
    }
    default: {
      const _exhaustive: never = config;
      throw new Error(`Unhandled discount config: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/**
 * Satıcının HAKEDİŞİNE esas birim satış tutarı — Trendyol karşılamalı kampanyalar için.
 *
 * Kampanya indirimi `D = price − effectiveUnitPrice(price, config)` kadardır; bunun
 * `fundingPct` yüzdesini Trendyol karşılar, kalanını satıcı üstlenir. Berkin'in canlı
 * kuralı (2026-08-02): komisyon, müşterinin ödediği tutardan DEĞİL bu tutardan kesilir —
 * 1.000 TL kampanya fiyatı + 100 TL indirim + %60 karşılama → komisyon 960 TL'den. Bu
 * yüzden karşılama ayrı bir gelir kalemi olarak modellenmez; tek bir etkin fiyata iner ve
 * komisyon, stopaj, KDV, marj hepsi bu tutardan yürür (kâr motorunda değişiklik yok).
 *
 * `fundingPct = 0` iken sonuç `effectiveUnitPrice` ile birebir aynıdır — İndirimler
 * dikeyi fonksiyonu bu değerle çağırır.
 */
export function sellerEffectivePrice(
  price: Decimal,
  config: DiscountConfig,
  fundingPct: Decimal,
): Decimal {
  if (price.lte(ZERO)) return ZERO;
  // Doğrulayıcı oranı zaten [0, 100] aralığına hapsediyor; burada savunmacı kırpma, saf
  // fonksiyonun doğrudan çağrıldığı testlerde ve gelecekteki çağıranlarda güvenlik payıdır.
  const funding = Decimal.min(Decimal.max(fundingPct, ZERO), HUNDRED);
  const discount = price.sub(effectiveUnitPrice(price, config));
  const sellerShare = Decimal.sub(1, funding.div(HUNDRED));
  return price.sub(discount.mul(sellerShare));
}

export type ScenarioPresentation = 'UNIT' | 'ORDER';

/**
 * Which row layout the list's config calls for (design §11, 2026-07-29 model). `UNIT` = the unit
 * price genuinely drops, so a row that shows the discounted unit is faithful: NET (all kinds) and
 * the conditional trio's (CONDITIONAL_BASKET / CONDITIONAL_QUANTITY / CODE) PERCENT variants, where
 * every unit sells at a flat lower percent. `ORDER` = the effective unit price is a synthetic
 * average, so the seller should reason about the whole order: BUY_X_PAY_Y and NTH_PRODUCT (all
 * kinds) plus the conditional trio's AMOUNT variants (a fixed discount split across the basket, not
 * a real per-unit cut).
 */
export function scenarioPresentation(config: DiscountConfig): ScenarioPresentation {
  switch (config.type) {
    case 'NET':
      return 'UNIT';
    case 'BUY_X_PAY_Y':
    case 'NTH_PRODUCT':
      return 'ORDER';
    case 'CONDITIONAL_BASKET':
    case 'CONDITIONAL_QUANTITY':
    case 'CODE':
      return config.valueKind === 'AMOUNT' ? 'ORDER' : 'UNIT';
    default: {
      const _exhaustive: never = config;
      throw new Error(`Unhandled discount config: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// ─── Three-tier commission chain ─────────────────────────────────────────────

/** Üç kademeli zincirin girdileri — kalem başına bir kez kurulur. */
export interface DiscountCommissionInputs {
  readonly bands: ReadonlyArray<StoredBand> | null; // 1. kademe: tarife bandı
  readonly productRate: Decimal | null; // 2. kademe: syncedCommissionRate
  readonly categoryRate: Decimal | null; // 3. kademe: kategori oranı
}
export type DiscountCommissionSource = 'band' | 'product' | 'category';
export interface ResolvedDiscountCommission {
  readonly pct: Decimal;
  readonly source: DiscountCommissionSource;
}

/**
 * Üç kademeli komisyon zinciri (Berkin kararı 2026-07-14): (1) fiyatı kapsayan
 * komisyon tarifesi bandı, (2) ürünün senkronlanan komisyonu, (3) kategori oranı.
 * Bant çözümü VERİLEN fiyattan yapılır — hangi fiyatın banda gireceğini çağıran seçer
 * ({@link commissionBandPrice}); indirim tipine göre cari ya da indirimli fiyat olur.
 */
export function resolveDiscountCommission(
  inputs: DiscountCommissionInputs,
  price: Decimal,
): ResolvedDiscountCommission | null {
  if (inputs.bands !== null && inputs.bands.length > 0) {
    const band = bandForPrice(inputs.bands, price);
    if (band !== null) return { pct: new Decimal(band.commissionPct), source: 'band' };
  }
  if (inputs.productRate !== null) return { pct: inputs.productRate, source: 'product' };
  if (inputs.categoryRate !== null) return { pct: inputs.categoryRate, source: 'category' };
  return null;
}

/**
 * Which price selects the commission BAND for the discounted scenario (Berkin kararı
 * 2026-07-14). The band is a rate keyed by the product's price segment; the MATRAH (the
 * revenue the commission + profit are computed on) is always the effective unit price and
 * is NOT affected by this choice — only the band/rate lookup is.
 *
 * - `NET` / `CONDITIONAL_BASKET` / `CONDITIONAL_QUANTITY` / `CODE` → the DISCOUNTED effective
 *   price: every unit genuinely sells cheaper, so that lower price's band is the real one (a
 *   band jump, e.g. %19→%12, is meaningful).
 * - `BUY_X_PAY_Y` / `NTH_PRODUCT` → the CURRENT (list) price: the unit's list price is
 *   unchanged — some units are free / one unit is discounted — so the product still sits in
 *   its original commission segment. For 4-al-2-öde @1000 the matrah is 500 but the rate comes
 *   from the 1000 band: commission = 500 × rate(1000-band).
 */
export function commissionBandPrice(
  currentPrice: Decimal,
  discountedEffectivePrice: Decimal,
  config: DiscountConfig,
): Decimal {
  switch (config.type) {
    case 'BUY_X_PAY_Y':
    case 'NTH_PRODUCT':
      return currentPrice;
    case 'NET':
    case 'CONDITIONAL_BASKET':
    case 'CONDITIONAL_QUANTITY':
    case 'CODE':
      return discountedEffectivePrice;
    default: {
      const _exhaustive: never = config;
      throw new Error(`Unhandled discount config: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/**
 * The assumed single-product-basket quantity (n) per discount type: the minimum quantity of THIS
 * product whose single-product basket satisfies the discount condition — ceil(minBasket/price) for
 * basket/code, minQuantity for quantity, buyQuantity for X-al-Y, nthIndex for Nth-product. NET has
 * no basket framing (its showcase price genuinely changes), so it never reaches an ORDER path; it
 * maps to 1 only to keep the switch exhaustive.
 */
export function assumedBasketQuantity(config: DiscountConfig, currentPrice: Decimal): number {
  switch (config.type) {
    case 'CONDITIONAL_BASKET':
    case 'CODE':
      return qualifyingQuantity(currentPrice, config.minBasketAmount);
    case 'CONDITIONAL_QUANTITY':
      return Math.max(config.minQuantity, 1);
    case 'BUY_X_PAY_Y':
      return config.buyQuantity;
    case 'NTH_PRODUCT':
      return Math.max(config.nthIndex, 1);
    case 'NET':
      return 1;
    default: {
      const _exhaustive: never = config;
      throw new Error(`Unhandled discount config: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// ─── Hedef hakediş tutarından kampanya fiyatına geri dönüş ──────────────────

/** Fiyat ızgarasının en küçük anlamlı adımı (1 kuruş) — parça sınırlarını ayırmakta kullanılır. */
const PRICE_EPSILON = new Decimal('0.01');

/**
 * `S(P) = k·P + (1 − k)·effectiveUnitPrice(P, config)` bağıntısının DOĞRUSAL kaldığı fiyat
 * aralıkları, `[minPrice, maxPrice]` penceresine kırpılmış hâlde ve artan sırada.
 *
 * Kırılımların kaynağı kurguya göre:
 *   - `NET` / `NTH_PRODUCT` (AMOUNT ya da FIXED_PRICE) TL indirimlerinde indirimin fiyatı aştığı
 *     nokta `P = X` — `max(price − X, 0)` (ya da FIXED_PRICE'ta `min(price, Y)`) tabanı orada
 *     kırılır.
 *   - `CONDITIONAL_QUANTITY/AMOUNT`'ta AYNI taban ama birim indirim `effectiveUnitPrice`'ın kendi
 *     böldüğü `value / minQuantity`'dir (`minQuantity` sabit, fiyattan bağımsız) — kırılım `value`
 *     DEĞİL `value / minQuantity`'dedir.
 *   - `CONDITIONAL_BASKET` / `CODE` TL varyantında `P = M / n` sınırları; `n` yalnız
 *     `ceil(M / maxPrice)` ile `ceil(M / minPrice)` arasında değer alabilir, dolayısıyla
 *     üretilen parça sayısı penceresiyle sınırlıdır.
 *   - Yüzde varyantlarında ve `BUY_X_PAY_Y`'de kırılım YOKTUR — tek parça.
 */
export function campaignPriceSegments(
  config: DiscountConfig,
  maxPrice: Decimal,
  minPrice: Decimal,
): Array<{ lo: Decimal; hi: Decimal }> {
  // decimal.js `x.div(0)` fırlatmaz, `Infinity` döner. `minPrice <= 0` geçilirse
  // `qualifyingQuantity(minPrice, config.minBasketAmount)` (aşağıdaki CONDITIONAL_BASKET/CODE
  // dalında `nHi`) sonsuza gider ve `for (let n = nLo; n <= nHi; n += 1)` hiç bitmeyen bir
  // döngüye düşer — sessiz bir askıda kalma, istisna DEĞİL. Fonksiyon dışa açık ve imzası
  // `minPrice` için bir alt sınır zorlamıyor; bu yüzden burada savunmacı kırpma uygulanıyor
  // (`sellerEffectivePrice`'ın `fundingPct` kırpmasıyla aynı duruş — fırlatmak yerine kırpma,
  // çünkü bu saf bir matematik commons dosyası ve hiçbir çağıran gerçekten "sıfır ya da negatif
  // fiyat" DEMEK istemez; en küçük anlamlı fiyat birimine, 1 kuruşa, kırpmak en iyi tanımlı
  // cevaptır).
  const safeMinPrice = Decimal.max(minPrice, PRICE_EPSILON);

  const cuts: Decimal[] = [];

  switch (config.type) {
    case 'NET':
      if (config.valueKind === 'AMOUNT') cuts.push(config.value);
      break;
    case 'CONDITIONAL_QUANTITY':
      if (config.valueKind === 'AMOUNT') {
        cuts.push(config.value.div(Math.max(config.minQuantity, 1)));
      }
      break;
    case 'NTH_PRODUCT':
      if (config.valueKind !== 'PERCENT') cuts.push(config.value);
      break;
    case 'CONDITIONAL_BASKET':
    case 'CODE': {
      if (config.valueKind === 'AMOUNT') {
        const nLo = qualifyingQuantity(maxPrice, config.minBasketAmount);
        const nHi = qualifyingQuantity(safeMinPrice, config.minBasketAmount);
        for (let n = nLo; n <= nHi; n += 1) {
          cuts.push(config.minBasketAmount.div(n));
        }
      }
      break;
    }
    case 'BUY_X_PAY_Y':
      break;
    default: {
      const _exhaustive: never = config;
      throw new Error(`Unhandled discount config: ${JSON.stringify(_exhaustive)}`);
    }
  }

  // Kırılımları pencereye kırp, sırala, tekilleştir; ardışık sınırlardan parçalar kur.
  const bounds = [safeMinPrice, maxPrice, ...cuts]
    .map((c) => c.toDecimalPlaces(2, Decimal.ROUND_CEIL))
    .filter((c) => c.gte(safeMinPrice) && c.lte(maxPrice))
    .sort((a, b) => a.comparedTo(b));

  const segments: Array<{ lo: Decimal; hi: Decimal }> = [];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const lo = bounds[i];
    const hi = bounds[i + 1];
    if (lo === undefined || hi === undefined) continue;
    if (hi.gt(lo)) segments.push({ lo, hi });
  }
  // Tek noktaya çöken pencere (minPrice === maxPrice) de değerlendirilebilmeli.
  if (segments.length === 0) segments.push({ lo: safeMinPrice, hi: maxPrice });
  return segments;
}

/**
 * The price window the segment walk searches for a target settlement price.
 * The lower bound is the TARGET, not a floor epsilon: `sellerEffectivePrice(P) <= P`
 * for every config (a discount never raises the price, and the funding share is in
 * [0,1]), so no campaign price below the target can ever reach it. Narrowing here is
 * what keeps the basket-amount segment count bounded. Returns null when the window
 * is empty — the target is unreachable at or below `maxPrice`.
 *
 * İspat (Türkçe): `S(P) = P − D·(1 − k)` biçimindedir, burada `D = P − effectiveUnitPrice(P,
 * config) ≥ 0` (bir indirim fiyatı asla YÜKSELTMEZ) ve `(1 − k) ∈ [0, 1]`. Dolayısıyla HER kurgu
 * ve HER karşılama oranı için `S(P) ≤ P` — hedeften daha düşük bir kampanya fiyatı hedefe asla
 * ulaşamaz. Bu alt sınır {@link campaignPriceSegments}'a geçirilen pencereyi daraltır:
 * `CONDITIONAL_BASKET` / `CODE` TL varyantında kırılım sayısı `ceil(M/maxPrice)`den
 * `ceil(M/targetSellerPrice)`e kadar sınırlanır (tasarım dokümanı §4.5) — eskiden `PRICE_EPSILON`'a
 * (1 kuruş) kadar inen pencere, 1000 TL'lik bir sepet eşiğinde ~100.000 kırılım üretiyordu; artık
 * hedefin altı hiç taranmıyor.
 */
export function campaignSearchWindow(
  targetSellerPrice: Decimal,
  maxPrice: Decimal,
): { readonly lo: Decimal; readonly hi: Decimal } | null {
  const hi = maxPrice.toDecimalPlaces(2, Decimal.ROUND_DOWN);
  if (hi.lt(PRICE_EPSILON)) return null;

  const lo = Decimal.max(targetSellerPrice, PRICE_EPSILON);
  if (lo.gt(hi)) return null;

  return { lo, hi };
}

/**
 * `sellerEffectivePrice(P, config, fundingPct) >= targetSellerPrice` koşulunu sağlayan EN KÜÇÜK
 * kampanya fiyatı `P` (kuruşa yukarı yuvarlanmış), ya da {@link campaignSearchWindow}'ın döndürdüğü
 * `[targetSellerPrice, maxPrice]` penceresinde böyle bir fiyat yoksa null.
 *
 * Neden ikili arama DEĞİL: `S` fiyatta monoton değildir. `CONDITIONAL_BASKET` TL varyantında
 * `n = ceil(M / P)` sıçraması `S`'yi düşürebilir (M=1000, X=100, karşılama 0: P=333 → S=308,
 * P=334 → S=300,67). İkili arama bu fonksiyonda sessizce yanlış cevap verir.
 *
 * Arama penceresi {@link campaignSearchWindow} ile hesaplanır — alt sınır `targetSellerPrice`'ın
 * kendisidir, `PRICE_EPSILON` DEĞİL (ispat orada). Hedef `maxPrice`'ın üstündeyse pencere boşa
 * düşer ve fonksiyon hemen null döner.
 *
 * Yöntem: {@link campaignPriceSegments} ile doğrusal parçalara ayrılır; her parçada `S`, parçanın
 * KENDİ doğrusal dalına ait iki noktada ÖRNEKLENEREK eğim ve kesişim çıkarılır (formül burada
 * ikinci kez yazılmaz — motorun `solvePriceForTarget` içinde kullandığı numaranın aynısı). Alt uç
 * doğrudan `seg.lo`'dur; üst örnekleme noktası ise `seg.hi`'nin KENDİSİ değil, ondan 1 kuruş
 * içeride kalan noktadır — `seg.hi`, kesikli bir kırılımın (CONDITIONAL_BASKET/CODE'un ceil
 * sıçraması) kuruşa yukarı yuvarlanmış hâli olabilir ve bu durumda artık komşu parçaya ait olur;
 * doğrudan orada örneklemek iki farklı doğrusal dalın ortalamasını çıkarıp eğimi bozar. Hedef bu
 * örneklerden kapalı formda çözülür ve kuruşa yukarı yuvarlanır. Sonuç parçanın içinde kalıyorsa
 * aday olur. Eğimin sıfır olduğu düz parçalarda parçanın alt ucu sınanır. Parça uçlarının
 * KENDİSİ (`seg.lo`, `seg.hi`) de ayrıca gerçek `sellerEffectivePrice` ile sınanıp adaylığa
 * eklenir — kapalı-form çözüm parçanın dışına düşse bile uçlar hâlâ doğru değerlendirilir. Tüm
 * adayların en küçüğü döner.
 *
 * Yuvarlama sonrası `S(P) >= hedef` bir kez daha DOĞRULANIR: kuruşa yuvarlama parça sınırını
 * aşan bir fiyat üretirse (ör. `ceil` bir sonraki adete atlarsa) o aday elenir.
 */
export function solveCampaignPriceForTarget(
  config: DiscountConfig,
  fundingPct: Decimal,
  targetSellerPrice: Decimal,
  maxPrice: Decimal,
): Decimal | null {
  const window = campaignSearchWindow(targetSellerPrice, maxPrice);
  if (window === null) return null;
  const { lo: searchLo, hi } = window;

  const candidates: Decimal[] = [];
  const consider = (candidate: Decimal): void => {
    if (candidate.lt(PRICE_EPSILON) || candidate.gt(hi)) return;
    if (sellerEffectivePrice(candidate, config, fundingPct).lt(targetSellerPrice)) return;
    candidates.push(candidate);
  };

  for (const seg of campaignPriceSegments(config, hi, searchLo)) {
    // `seg.hi`, kesikli bir kırılımın (CONDITIONAL_BASKET/CODE'un ceil sıçraması) kuruşa
    // YUKARI yuvarlanmış hâli olabilir — bu durumda `seg.hi`'nin kendisi artık komşu (bir
    // sonraki) parçaya ait olur, doğrudan orada örneklemek eğim/kesişimi YANLIŞ hesaplar
    // (iki farklı doğrusal dalın ortalamasını çıkarır). Eğim örneklemesi bu yüzden `seg.hi`
    // yerine ondan 1 kuruş içeride kalan bir noktadan yapılır — parçanın KENDİ doğrusal dalı
    // garanti örneklenir. Parça 1 kuruştan darsa (nadiren) bu nokta `seg.lo`'ya çöker; o durum
    // aşağıdaki `sHi.eq(sLo)` düz-parça dalına düşer ve zarar vermez.
    const sampleHi = Decimal.max(seg.hi.sub(PRICE_EPSILON), seg.lo);
    const sLo = sellerEffectivePrice(seg.lo, config, fundingPct);
    const sHi = sellerEffectivePrice(sampleHi, config, fundingPct);
    if (sHi.eq(sLo)) {
      // Düz parça: fiyat değişimi hakedişi değiştirmiyor → alt uç yeterli.
      consider(seg.lo);
      continue;
    }
    const slope = sHi.sub(sLo).div(sampleHi.sub(seg.lo));
    const intercept = sLo.sub(slope.mul(seg.lo));
    const exact = targetSellerPrice.sub(intercept).div(slope);
    consider(exact.toDecimalPlaces(2, Decimal.ROUND_CEIL));
    // Parça uçları da aday: kapalı-form çözüm parçanın DIŞINA düşerse doğru cevap uçta olabilir.
    consider(seg.lo);
    consider(seg.hi);
  }

  if (candidates.length === 0) return null;
  return candidates.reduce((min, c) => (c.lt(min) ? c : min));
}
