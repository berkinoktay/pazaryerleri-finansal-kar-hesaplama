// Kampanyalar (Trendyol'un kurguladığı kampanyalara katılım) kâr hesabı.
//
// İndirimler'in `discount-compute.service.ts` kardeşiyle aynı iskelet: senaryo kurma
// primitifleri `discount-scenario-commons.ts`'ten, tür matematiği `discount-math-commons.ts`'ten
// gelir; burada yalnız BU dikeye özgü iki şey yaşar:
//
//  1. ÜÇ senaryo (İndirimler'in ikisi yerine): `current` (katılmazsam bugünkü kârım),
//     `maxScenario` (Excel'in izin verdiği en yüksek fiyattan katılırsam), `customScenario`
//     (satıcının yazdığı daha düşük fiyattan katılırsam; fiyat yoksa null).
//
//  2. TRENDYOL KARŞILAMASI. Kampanya promosyonu satıcının girdiği kampanya fiyatının ÜSTÜNE
//     çalışır ve indirimin bir kısmını Trendyol üstlenir. Berkin'in canlı kuralı (tasarım §4.2,
//     karar 5): komisyon müşterinin ödediğinden DEĞİL, satıcının hakedişine esas tutardan kesilir
//     — 1.000 TL kampanya fiyatı + %10 indirim + %60 karşılama → matrah 960. Bu tutarı
//     `sellerEffectivePrice` verir; komisyon, stopaj, KDV ve marj hepsi ondan yürür, kâr
//     motorunda hiçbir değişiklik gerekmez.
//
// Sepet (sipariş) senaryosunda da gelir SATICININ sepet hakedişidir, müşterinin ödediği tutar
// değil; ikisinin farkı `trendyolFundedTotal` alanı olarak ayrıca döner.

import { Decimal } from 'decimal.js';

import { solvePriceForTarget, type EstimateOutcome } from '@pazarsync/profit';

import {
  assumedBasketQuantity,
  commissionBandPrice,
  effectiveUnitPrice,
  resolveDiscountCommission,
  scenarioPresentation,
  sellerEffectivePrice,
  solveCampaignPriceForTarget,
  type DiscountCommissionInputs,
  type DiscountConfig,
  type ResolvedDiscountCommission,
} from './discount-math-commons';
import {
  computeOrderBreakdown,
  priceScenario,
  toEstimate,
  toScenario,
  type ComputedPriceScenario,
  type ComputedScenarioEstimate,
  type ScenarioCompute,
  type ScenarioItemReason,
} from './campaign-scenario-legacy';
import { assembleUnitEconomics } from './product-pricing.service';
import {
  tariffCommission,
  type TariffAssemblyContext,
  type TariffVariant,
} from './tariff-compute-commons';
import type { CampaignBasketScenario } from '../validators/marketplace-campaign.validator';
import type { VariantCostAggregate } from '../validators/product.validator';

// Re-exported so the detail / estimate / target-margin services import the assembly
// context + variant shapes from one place, exactly as the İndirimler sibling does.
export type { TariffAssemblyContext, TariffVariant };

const ZERO = new Decimal(0);

export type CampaignItemReason = ScenarioItemReason;

export type ComputedCampaignScenario = ComputedPriceScenario;

/** Bir kampanya kaleminin üç fiyat senaryosu + sepet çerçevesi. */
export interface ComputedCampaignItem {
  readonly calculable: boolean;
  readonly reason: CampaignItemReason | null;
  /** Kampanyasız taban: bugünkü satış fiyatı, promosyon uygulanmadan. */
  readonly current: ComputedCampaignScenario;
  /** Excel'in "Maksimum Girebileceğin Fiyat" değerinden katılım senaryosu. */
  readonly maxScenario: ComputedCampaignScenario;
  /** Satıcının yazdığı özel fiyattan katılım senaryosu; fiyat girilmemişse null. */
  readonly customScenario: ComputedCampaignScenario | null;
  /**
   * Maksimum fiyat seçeneğinin sepet kapsamlı hakediş senaryosu — wire tipi doğrudan
   * doğrulayıcıdan gelir (`CampaignBasketScenarioSchema`), böylece aynı şekil ikinci kez
   * TANIMLANMAZ ve detay servisi blokları olduğu gibi geçirebilir.
   */
  readonly maxBasket: CampaignBasketScenario | null;
  /** Özel fiyat seçeneğinin sepet senaryosu; özel fiyat yazılmamışsa null. */
  readonly customBasket: CampaignBasketScenario | null;
}

/** `computeCampaignItem`'ın kalem başına girdileri. */
export interface ComputeCampaignItemInput {
  /** "Mevcut Satış Fiyatı" — kampanyasız taban senaryonun fiyatı. */
  readonly currentPrice: Decimal;
  /** "Maksimum Girebileceğin Fiyat" — birinci fiyat seçeneği ve özel fiyatın tavanı. */
  readonly maxPrice: Decimal;
  /** Satıcının yazdığı özel fiyat; yazılmamışsa null. Seçimden BAĞIMSIZ saklanır (tasarım §3). */
  readonly customPrice: Decimal | null;
  readonly config: DiscountConfig;
  /** Trendyol karşılama oranı, yüzde (60 = %60). Karşılama bilinmiyorsa 0. */
  readonly fundingPct: Decimal;
}

/**
 * Bir kampanya fiyatının (P) iki türev fiyatı.
 *
 * - `settlementPrice` (S): satıcının HAKEDİŞİNE esas birim tutar, yani komisyonun MATRAHI.
 *   `sellerEffectivePrice` verir; müşterinin ödediği `effectiveUnitPrice`'tan karşılama payı
 *   kadar YÜKSEKTİR.
 * - `bandPrice`: komisyon BANDINI seçen fiyat. `commissionBandPrice` kurguya göre belirler:
 *   `BUY_X_PAY_Y` / `NTH_PRODUCT`'ta ürünün raf fiyatı değişmediği için kampanya fiyatı P,
 *   diğer kurgularda her birim gerçekten ucuza satıldığı için hakediş fiyatı S (tasarım §4.3).
 *   Matrah bu seçimden ETKİLENMEZ; yalnız oran değişir.
 */
function campaignScenarioPrices(
  price: Decimal,
  config: DiscountConfig,
  fundingPct: Decimal,
): { readonly settlementPrice: Decimal; readonly bandPrice: Decimal } {
  const settlementPrice = sellerEffectivePrice(price, config, fundingPct);
  return { settlementPrice, bandPrice: commissionBandPrice(price, settlementPrice, config) };
}

/**
 * Sepet kapsamlı hakediş senaryosu (tasarım §4.4, profit-formula.md §2.4): sepetin yalnız BU
 * üründen ve koşulu karşılayan en küçük adetten (n) oluştuğu varsayımıyla kampanya siparişinin
 * dökümü. Zincir modaldeki sırayla kapanır:
 *
 *   sepet tutarı (n × P)
 *     − kampanya indirimi        → müşterinin ödediği (n × birim etkin fiyat)
 *     + Trendyol'un karşıladığı  → satıcının hakedişi (n × birim hakediş fiyatı)
 *     → sipariş kârı (motor, hakediş tutarı üzerinden)
 *
 * `basketTotal` KAMPANYA fiyatından kurulur (güncel fiyattan değil): promosyon kampanya
 * fiyatının üstüne çalışır, dolayısıyla "kampanya indirimi" satırı yalnız promosyonun payıdır ve
 * `trendyolFundedTotal` gerçekten onun bir yüzdesi olur. `trendyolFundedTotal` iki toplamın
 * FARKI olarak yazılır (oranla yeniden çarpılmaz), böylece ödenen + karşılanan = hakediş
 * eşitliği kuruşuna kadar kapanır.
 *
 * Sipariş kârı `computeOrderBreakdown` ile SATICININ sepet hakedişinden hesaplanır — müşterinin
 * ödediğinden değil; komisyon ve hakediş satıcının tutarından yürür (karar 5). Model n× ürün
 * maliyeti, 1× kargo, 1× PSF'tir (kargo ve platform hizmet bedeli koli başına bir kez).
 * `currentOrderNetProfit` aynı n birimi kampanyasız, güncel fiyattan fiyatlar — elmayla elma
 * karşılaştırması. Karşılama sıfırken hakediş toplamı ödenen toplama eşitlenir ve blok
 * İndirimler'in ürettiğiyle birebir aynı olur.
 *
 * `NET` kurgusunda null döner (vitrin fiyatı gerçekten değiştiği için sepet çerçevesi anlamsız),
 * pozitif olmayan kampanya fiyatında da null (n, fiyata bölünerek bulunur).
 */
function buildCampaignBasketScenario(
  ctx: TariffAssemblyContext,
  variant: TariffVariant | null,
  cost: VariantCostAggregate | undefined,
  shipping: EstimateOutcome,
  currentPrice: Decimal,
  campaignPrice: Decimal,
  config: DiscountConfig,
  fundingPct: Decimal,
  currentResolved: ResolvedDiscountCommission | null,
  campaignResolved: ResolvedDiscountCommission | null,
): CampaignBasketScenario | null {
  if (config.type === 'NET' || campaignPrice.lte(ZERO)) return null;

  const n = assumedBasketQuantity(config, campaignPrice);
  // Satırda gösterilen 2 haneli birim fiyatların AYNISI ile çarpılır; modal satırla çelişemez.
  const paidUnit2dp = effectiveUnitPrice(campaignPrice, config).toDecimalPlaces(2);
  const sellerUnit2dp = sellerEffectivePrice(campaignPrice, config, fundingPct).toDecimalPlaces(2);

  const basketTotal = campaignPrice.mul(n);
  const basketPaidTotal = paidUnit2dp.mul(n);
  const sellerBasketTotal = sellerUnit2dp.mul(n);

  const campaignOrder = computeOrderBreakdown(
    ctx,
    variant,
    cost,
    shipping,
    campaignResolved,
    n,
    sellerBasketTotal,
  );
  const currentOrder = computeOrderBreakdown(
    ctx,
    variant,
    cost,
    shipping,
    currentResolved,
    n,
    currentPrice.mul(n),
  );

  return {
    assumedQuantity: n,
    basketTotal: basketTotal.toFixed(2),
    basketPaidTotal: basketPaidTotal.toFixed(2),
    basketDiscountTotal: basketTotal.sub(basketPaidTotal).toFixed(2),
    // Varsayılan sepette Trendyol'un karşıladığı toplam: satıcının hakedişi eksi müşterinin
    // ödediği. Karşılama sıfırken ikisi eşitlenir ve alan "0.00" olur.
    trendyolFundedTotal: sellerBasketTotal.sub(basketPaidTotal).toFixed(2),
    orderNetProfit: campaignOrder !== null ? campaignOrder.netProfit.toFixed(2) : null,
    orderMarginPct:
      campaignOrder !== null && campaignOrder.saleMarginPct !== null
        ? campaignOrder.saleMarginPct.toFixed(2)
        : null,
    currentOrderNetProfit: currentOrder !== null ? currentOrder.netProfit.toFixed(2) : null,
  };
}

/**
 * Bir kampanya kaleminin ÜÇ senaryosunu ve iki fiyat seçeneğinin sepet çerçevesini hesaplar:
 *
 * - `current`: matrah ve bant `currentPrice` — kampanyaya katılmama hâli.
 * - `maxScenario`: matrah `sellerEffectivePrice(maxPrice, config, fundingPct)`, bant
 *   {@link campaignScenarioPrices} kuralıyla.
 * - `customScenario`: aynı hesap `customPrice` ile; fiyat girilmemişse null.
 *
 * Kalemin hesaplanabilirliği ve gerekçesi MEVCUT senaryodan gelir — listede görünen "bugünkü
 * durum" odur; ürün eşleşmemişse ya da maliyet/komisyon/kargo eksikse üç senaryo da boş kalır.
 *
 * Sepet blokları ({@link buildCampaignBasketScenario}) HER seçenek için KENDİ fiyatından ayrı
 * kurulur: `maxBasket` maksimum fiyattan, `customBasket` özel fiyattan (fiyat yoksa null).
 * Sipariş gösterimli kurgularda (`BUY_X_PAY_Y`, `NTH_PRODUCT`, koşulluların TL varyantları)
 * satırdaki iki fiyat kartı da kendi siparişini gösterir (Berkin kararı, 2026-10-22); satıcının
 * hangi seçeneği işaretlediği bu hesaba GİRMEZ — seçim ekranın yerel tamponunda yaşar ve iki
 * kartın manşet rakamı da işaretlemeden bağımsız olarak kendi fiyatının sepetidir.
 */
export function computeCampaignItem(
  ctx: TariffAssemblyContext,
  variant: TariffVariant | null,
  cost: VariantCostAggregate | undefined,
  shipping: EstimateOutcome,
  commission: DiscountCommissionInputs,
  input: ComputeCampaignItemInput,
): ComputedCampaignItem {
  const { currentPrice, maxPrice, customPrice, config, fundingPct } = input;

  /**
   * Bir KAMPANYA fiyatının senaryosu: matrah + bant türetmesi ve zincir çözümü tek adımda,
   * kampanya fiyatının kendisiyle birlikte. Üçlü bir arada döndüğü için sepet bloğunun
   * kullandığı fiyat ile o fiyatın komisyonu birbirinden AYRILAMAZ.
   */
  const scenarioAt = (
    price: Decimal,
  ): {
    readonly price: Decimal;
    readonly settlementPrice: Decimal;
    readonly compute: ScenarioCompute;
  } => {
    const { settlementPrice, bandPrice } = campaignScenarioPrices(price, config, fundingPct);
    return {
      price,
      settlementPrice,
      compute: priceScenario(ctx, variant, cost, shipping, commission, settlementPrice, bandPrice),
    };
  };

  // Kampanyasız taban: matrah da bant da güncel fiyattır.
  const current = priceScenario(
    ctx,
    variant,
    cost,
    shipping,
    commission,
    currentPrice,
    currentPrice,
  );
  const max = scenarioAt(maxPrice);
  const custom = customPrice !== null ? scenarioAt(customPrice) : null;

  /**
   * Bir seçeneğin sepet çerçevesi: kendi kampanya fiyatından kurulur, aynı n birimin
   * kampanyasız karşılığı ise güncel fiyatın komisyonuyla fiyatlanır.
   */
  const basketFor = (priced: ReturnType<typeof scenarioAt>): CampaignBasketScenario | null =>
    buildCampaignBasketScenario(
      ctx,
      variant,
      cost,
      shipping,
      currentPrice,
      priced.price,
      config,
      fundingPct,
      current.resolved,
      priced.compute.resolved,
    );

  return {
    calculable: current.calculable,
    reason: current.reason,
    current: toScenario(currentPrice, current),
    maxScenario: toScenario(max.settlementPrice, max.compute),
    customScenario: custom !== null ? toScenario(custom.settlementPrice, custom.compute) : null,
    maxBasket: basketFor(max),
    customBasket: custom !== null ? basketFor(custom) : null,
  };
}

// ─── Tek senaryonun tam dökümü (kâr dökümü modali) ──────────────────────────

/** `computeCampaignEstimate`'in girdileri — hangi fiyatın hangi çerçevede fiyatlanacağı. */
export interface ComputeCampaignEstimateInput {
  /** Senaryonun KAMPANYA fiyatı: `current` için kalemin güncel fiyatı, diğerlerinde max/özel fiyat. */
  readonly price: Decimal;
  /**
   * Kalemin güncel ("Mevcut Satış Fiyatı") fiyatı. Sipariş kapsamındaki sepet bloğu aynı n
   * birimin KAMPANYASIZ karşılığını (`currentOrderNetProfit`) bu fiyattan kurar — modal, satırdaki
   * kartın "kampanyasız aynı siparişe göre" farkıyla aynı tabanı kullansın diye.
   */
  readonly currentPrice: Decimal;
  readonly config: DiscountConfig;
  readonly fundingPct: Decimal;
  /** `current` senaryosunda false: satıcı katılmıyor, promosyon da karşılama da yok. */
  readonly applyCampaign: boolean;
}

export interface ComputedCampaignEstimate extends ComputedScenarioEstimate {
  /** Dökümün fiyatlandığı tutar: birim kapsamda hakediş fiyatı, sipariş kapsamında sepet hakedişi. */
  readonly price: Decimal;
  readonly scope: 'unit' | 'order';
  /**
   * Sipariş kapsamında dökümün sepet çerçevesi — satırdaki kartın `maxBasket` / `customBasket`
   * bloğuyla AYNI hesap (n, sepet tutarı, müşterinin ödediği, Trendyol'un karşıladığı, sipariş
   * kârı ve aynı siparişin kampanyasız kârı). Birim kapsamda null.
   */
  readonly basket: CampaignBasketScenario | null;
}

/**
 * Tek senaryonun tam kâr dökümü. Fiyat türetmesi `computeCampaignItem` ile AYNI yoldan geçer
 * ({@link campaignScenarioPrices}), bu yüzden modal satırla asla çelişemez.
 *
 * Kapsam kurgunun gösterimini VE senaryoyu birlikte izler. Sipariş gösterimli kurgularda
 * (`BUY_X_PAY_Y` / `NTH_PRODUCT` / koşulluların TL varyantları) kampanya senaryoları (`max`,
 * `custom`) SİPARİŞ dökümü döner: birim-etkin fiyat yapay bir ortalamadır ve satırdaki fiyat
 * kartlarının manşeti de sipariş toplamıdır; sepet o senaryonun KENDİ fiyatından kurulur. Gelir
 * satıcının sepet hakedişidir (müşterinin ödediği değil).
 *
 * Kampanyasız `current` her zaman BİRİM dökümü döner: katılmayan satıcının bugünkü satışı tek
 * ürünlük bir siparişdir ve satırın mevcut hücresi de birim kârı gösterir, yani modal tıklanan
 * rakamla aynı tabanda kalır. Birim gösterimli kurgularda her senaryo birim dökümü döner.
 * Hesaplanabilirlik, gerekçe ve komisyon her iki kapsamda da BİRİM çözümünden gelir.
 */
export function computeCampaignEstimate(
  ctx: TariffAssemblyContext,
  variant: TariffVariant | null,
  cost: VariantCostAggregate | undefined,
  shipping: EstimateOutcome,
  commission: DiscountCommissionInputs,
  input: ComputeCampaignEstimateInput,
): ComputedCampaignEstimate {
  const { price, currentPrice, config, fundingPct, applyCampaign } = input;
  const { settlementPrice, bandPrice } = applyCampaign
    ? campaignScenarioPrices(price, config, fundingPct)
    : { settlementPrice: price, bandPrice: price };

  const computed = priceScenario(
    ctx,
    variant,
    cost,
    shipping,
    commission,
    settlementPrice,
    bandPrice,
  );

  // Pozitif olmayan fiyatta sepet kurulamaz (n, fiyata bölünerek bulunur) — satırın sepet bloğu
  // da o durumda null'dır, dolayısıyla birim dökümüne düşmek satırla tutarlıdır.
  const wantOrder = applyCampaign && scenarioPresentation(config) === 'ORDER' && price.gt(ZERO);
  if (!wantOrder) {
    return {
      ...toEstimate(computed, computed.breakdown),
      price: settlementPrice,
      scope: 'unit',
      basket: null,
    };
  }

  const n = assumedBasketQuantity(config, price);
  const orderRevenue = settlementPrice.toDecimalPlaces(2).mul(n);
  const order = computeOrderBreakdown(
    ctx,
    variant,
    cost,
    shipping,
    computed.resolved,
    n,
    orderRevenue,
  );
  // Aynı n birimin kampanyasız karşılığı, satırdaki blokta olduğu gibi güncel fiyatın komisyonuyla
  // fiyatlanır (matrah ve bant güncel fiyattır).
  const current = priceScenario(
    ctx,
    variant,
    cost,
    shipping,
    commission,
    currentPrice,
    currentPrice,
  );
  const basket = buildCampaignBasketScenario(
    ctx,
    variant,
    cost,
    shipping,
    currentPrice,
    price,
    config,
    fundingPct,
    current.resolved,
    computed.resolved,
  );
  return { ...toEstimate(computed, order), price: orderRevenue, scope: 'order', basket };
}

// ─── Hedef marja göre fiyat önerisi ─────────────────────────────────────────

/** Hedef marj çözümünün kalem başına girdileri (kalem kimliği + çözülmüş ekonomik girdiler). */
export interface CampaignTargetMarginItem {
  readonly itemId: string;
  readonly variant: TariffVariant | null;
  readonly cost: VariantCostAggregate | undefined;
  readonly shipping: EstimateOutcome;
  readonly commission: DiscountCommissionInputs;
  /** "Maksimum Girebileceğin Fiyat" — önerinin tavanı. */
  readonly maxPrice: Decimal;
}

export interface CampaignTargetMarginInput {
  readonly config: DiscountConfig;
  readonly fundingPct: Decimal;
  /** Hedef net kâr marjı, yüzde. */
  readonly targetMarginPct: Decimal;
}

export interface CampaignTargetMarginSuggestion {
  readonly itemId: string;
  /** Hedefi tutturan en küçük kampanya fiyatı (2 hane); `reason` doluysa null. */
  readonly price: string | null;
  readonly reason: 'UNREACHABLE' | 'NOT_CALCULABLE' | null;
}

/**
 * Her kalem için hedef marjı tutturan EN KÜÇÜK kampanya fiyatını önerir. İki adım (tasarım §4.5):
 *
 *  1. Hedef HAKEDİŞ tutarı: net kâr hakedişte doğrusaldır, motorun `solvePriceForTarget`
 *     fonksiyonu hedef marjı tutturan `S`'yi kapalı formda verir. Yeni matematik yazılmaz.
 *  2. `S`'den kampanya fiyatına geri dönüş: `solveCampaignPriceForTarget`,
 *     `sellerEffectivePrice(P) >= S` koşulunu sağlayan en küçük `P`'yi parça parça çözümle bulur
 *     (ikili arama kullanılmaz — `S` fiyatta monoton değildir).
 *
 * Komisyon oranı kalem başına BİR kez, MAKSİMUM fiyatın bandından çözülür: motorun hedef çözümü
 * sabit bir orana ihtiyaç duyar, oysa oran fiyatın bandına bağlıdır — döngüyü kırmak için satıcının
 * girebileceği en yüksek fiyat çapa alınır. Önerilen fiyat daha düşük bir banda düşerse satırın
 * KENDİ senaryosu (`computeCampaignItem`) gerçek oranla yeniden hesaplandığı için satıcı doğru kârı
 * görür; öneri "iyimser tahmin, hakediş düzeltir" ilkesine uyar.
 *
 * `NOT_CALCULABLE`: ürün eşleşmedi ya da maliyet/kargo/komisyon eksik. `UNREACHABLE`: hedef hiçbir
 * fiyatta tutmuyor ya da tutturan fiyat maksimumun üstünde. Bu fonksiyon HESAPLAR ve DÖNER —
 * veritabanına hiçbir şey yazmaz (seçim kalıcılığı "Kaydet ve İndir" anındadır, tasarım §6).
 */
export function suggestTargetMarginPrices(
  ctx: TariffAssemblyContext,
  items: readonly CampaignTargetMarginItem[],
  input: CampaignTargetMarginInput,
): CampaignTargetMarginSuggestion[] {
  const { config, fundingPct, targetMarginPct } = input;

  return items.map((item): CampaignTargetMarginSuggestion => {
    const notCalculable = { itemId: item.itemId, price: null, reason: 'NOT_CALCULABLE' } as const;
    const unreachable = { itemId: item.itemId, price: null, reason: 'UNREACHABLE' } as const;

    if (item.variant === null) return notCalculable;

    const { bandPrice } = campaignScenarioPrices(item.maxPrice, config, fundingPct);
    const resolved = resolveDiscountCommission(item.commission, bandPrice.toDecimalPlaces(2));
    if (resolved === null) return notCalculable;

    const probe = assembleUnitEconomics(ctx, item.variant, {
      costAggregate: item.cost,
      commission: tariffCommission(resolved.pct),
      shipping: item.shipping,
    });
    if (probe.econ === null) return notCalculable;

    // 1. adım: hedef marjı tutturan hakediş tutarı. Çözülemeyen her durum (marj fiyatla
    // ulaşılamıyor / kâr fiyata duyarsız) satıcı açısından aynı sonuca çıkar: ulaşılamaz.
    const solved = solvePriceForTarget(probe.econ, { type: 'margin', value: targetMarginPct });
    if (!solved.calculable) return unreachable;

    // 2. adım: o hakedişi maksimum fiyatı aşmadan veren en küçük kampanya fiyatı.
    const campaignPrice = solveCampaignPriceForTarget(
      config,
      fundingPct,
      solved.price,
      item.maxPrice,
    );
    if (campaignPrice === null) return unreachable;

    return { itemId: item.itemId, price: campaignPrice.toFixed(2), reason: null };
  });
}
