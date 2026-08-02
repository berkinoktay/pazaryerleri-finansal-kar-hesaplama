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
