// Profit math for Kampanyalar (seller participation in Trendyol-designed campaigns).
//
// Same skeleton as the Indirimler sibling (`discount-compute.service.ts`): the scenario
// primitives come from `discount-scenario-commons.ts` (engine-backed) and the type math from
// `discount-math-commons.ts`. Only two things are specific to this vertical:
//
//   1. THREE scenarios instead of Indirimler's two: `current` (today's profit if I do not
//      join), `maxScenario` (joining at the Excel's highest allowed price), `customScenario`
//      (joining at the seller's own, lower price; null when none is typed).
//
//   2. THE TRENDYOL FUNDING. A campaign promotion runs on TOP of the price the seller enters
//      and Trendyol absorbs part of the discount. Owner's live rule (design 4.2, decision 5):
//      commission is charged NOT on what the customer pays but on the seller's settlement
//      amount -- 1,000 TL campaign price + 10% discount + 60% funding -> matrah 960.
//      `sellerEffectivePrice` yields that amount; commission, stoppage, VAT and margin all run
//      off it, so the profit engine needs no change.
//
// In the basket (order) scenario the revenue is likewise the SELLER's basket settlement, not
// what the customer pays; the difference is reported separately as `trendyolFundedTotal`.
//
// No financial math lives here that the engine does not own
// (feedback_no_frontend_financial_calculation): every number flows through the shared
// `priceScenario` and the engine (`@pazarsync/profit`).

import { Decimal } from 'decimal.js';

import { solveTrendyolScenarioPrice } from '@pazarsync/profit';

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
} from './discount-math-commons';
import {
  priceScenario,
  scenarioBreakdown,
  scenarioMarginPct,
  scenarioNetProfit,
  toEstimate,
  toScenario,
  type ComputedPriceScenario,
  type ComputedScenarioEstimate,
  type ScenarioCompute,
  type ScenarioItemReason,
} from './discount-scenario-commons';
import {
  toKurusHalfUp,
  type RequestFailureLog,
  type ScreenScenarioBase,
} from './scenario-screen-commons';
import type { CampaignBasketScenario } from '../validators/marketplace-campaign.validator';

const ZERO = new Decimal(0);

/** The lowest unit price the scenario solver accepts; below it there is nothing to solve. */
const MIN_SCENARIO_UNIT_PRICE = new Decimal('0.01');

export type CampaignItemReason = ScenarioItemReason;

export type ComputedCampaignScenario = ComputedPriceScenario;

/** A campaign item's three price scenarios plus each price option's basket framing. */
export interface ComputedCampaignItem {
  readonly calculable: boolean;
  readonly reason: CampaignItemReason | null;
  /** Campaign-free baseline: today's sale price with no promotion applied. */
  readonly current: ComputedCampaignScenario;
  /** Joining at the Excel's "Maksimum Girebileceğin Fiyat". */
  readonly maxScenario: ComputedCampaignScenario;
  /** Joining at the seller's own typed price; null when none is typed. */
  readonly customScenario: ComputedCampaignScenario | null;
  /** The max price option's basket (order) framing; the wire type comes from the validator. */
  readonly maxBasket: CampaignBasketScenario | null;
  /** The custom price option's basket framing; null when no custom price is typed. */
  readonly customBasket: CampaignBasketScenario | null;
}

/**
 * A campaign price's two derived prices.
 *
 * - `settlementPrice` (S): the per-unit amount the seller SETTLES on, i.e. the commission
 *   matrah. `sellerEffectivePrice` yields it; it is HIGHER than what the customer pays
 *   (`effectiveUnitPrice`) by Trendyol's funded share.
 * - `bandPrice`: the price that SELECTS the commission band. `commissionBandPrice` decides it
 *   per config: for `BUY_X_PAY_Y` / `NTH_PRODUCT` the shelf price is unchanged so it is the
 *   campaign price P; otherwise every unit genuinely sells cheaper so it is the settlement
 *   price S (design 4.3). Only the rate changes with this choice; the matrah does not.
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
 * The basket (order) settlement scenario (design 4.4, profit-formula.md 2.4): assuming the
 * basket holds only THIS product at the minimum qualifying quantity n, the campaign order's
 * breakdown. The money chain closes in the modal's order:
 *
 *   basket total (n x P)
 *     - campaign discount    -> what the customer pays (n x effective unit)
 *     + Trendyol's funded     -> the seller's settlement (n x settlement unit)
 *     -> order profit (engine, over the settlement total)
 *
 * `basketTotal` is built from the CAMPAIGN price (not the current price): the promotion runs on
 * top of the campaign price, so the "campaign discount" line is the promotion's share alone and
 * `trendyolFundedTotal` is genuinely a percentage of it. `trendyolFundedTotal` is written as the
 * DIFFERENCE of the two totals (never the rate re-applied), so paid + funded closes on the
 * settlement total to the kurus.
 *
 * Both order profits run the engine over the n-unit basket via `priceScenario(quantity: n)` --
 * the engine prices n cost units, one shipping and one platform-service fee per parcel, and desi
 * scales by n (so a large basket can exceed the carrier's desi limit and that order profit is
 * null while the row stays). The campaign order's revenue IS the seller's settlement basket
 * (unit price = the 2dp settlement unit), not what the customer pays; `currentOrderNetProfit`
 * prices the same n units campaign-free at the current price -- an apples-to-apples baseline.
 *
 * Null for `NET` (its showcase price genuinely changes, so no basket framing) or a non-positive
 * campaign price (n is found by dividing by the price).
 */
function buildCampaignBasketScenario(params: {
  readonly base: ScreenScenarioBase;
  readonly commission: DiscountCommissionInputs;
  readonly currentPrice: Decimal;
  readonly campaignPrice: Decimal;
  readonly config: DiscountConfig;
  readonly fundingPct: Decimal;
}): CampaignBasketScenario | null {
  const { base, commission, currentPrice, campaignPrice, config, fundingPct } = params;
  if (config.type === 'NET' || campaignPrice.lte(ZERO)) return null;

  const n = assumedBasketQuantity(config, campaignPrice);
  // Multiplied by the SAME 2dp unit prices the row shows, so the modal can never disagree.
  const paidUnit2dp = effectiveUnitPrice(campaignPrice, config).toDecimalPlaces(2);
  const sellerUnit2dp = sellerEffectivePrice(campaignPrice, config, fundingPct).toDecimalPlaces(2);

  const basketTotal = campaignPrice.mul(n);
  const basketPaidTotal = paidUnit2dp.mul(n);
  const sellerBasketTotal = sellerUnit2dp.mul(n);

  // The campaign order: unit price = the seller's 2dp settlement (so saleGross = the seller
  // basket total), band from the campaign price's band-lookup price.
  const { bandPrice } = campaignScenarioPrices(campaignPrice, config, fundingPct);
  const campaignOrder = priceScenario({
    base,
    commission,
    price: sellerUnit2dp,
    bandPrice,
    quantity: n,
  });
  // The same n units campaign-free: matrah and band both the current price.
  const currentOrder = priceScenario({
    base,
    commission,
    price: currentPrice,
    bandPrice: currentPrice,
    quantity: n,
  });

  return {
    assumedQuantity: n,
    basketTotal: basketTotal.toFixed(2),
    basketPaidTotal: basketPaidTotal.toFixed(2),
    basketDiscountTotal: basketTotal.sub(basketPaidTotal).toFixed(2),
    // Trendyol's funded total in the assumed basket: the seller's settlement minus what the
    // customer paid. At funding 0 the two are equal and the field is "0.00".
    trendyolFundedTotal: sellerBasketTotal.sub(basketPaidTotal).toFixed(2),
    orderNetProfit: scenarioNetProfit(campaignOrder),
    orderMarginPct: scenarioMarginPct(campaignOrder),
    currentOrderNetProfit: scenarioNetProfit(currentOrder),
  };
}

/**
 * Computes a campaign item's THREE scenarios and each price option's basket framing:
 *
 * - `current`: matrah and band both `currentPrice` -- not joining the campaign.
 * - `maxScenario`: matrah `sellerEffectivePrice(maxPrice, config, fundingPct)`, band by
 *   {@link campaignScenarioPrices}.
 * - `customScenario`: the same at `customPrice`; null when none is typed.
 *
 * Calculability and reason come from the CURRENT scenario -- the "today" figure the row shows;
 * an unmatched product or a missing cost/commission/shipping empties all three scenarios.
 *
 * Each price option carries its OWN basket block ({@link buildCampaignBasketScenario}) built
 * from its own price: `maxBasket` from the maximum, `customBasket` from the custom price (null
 * when none). The seller's saved selection does NOT enter this compute (design decision
 * 2026-10-22); selection lives in the screen's local buffer and both cards headline their own
 * basket regardless of which option is marked.
 */
export function computeCampaignItem(params: {
  readonly base: ScreenScenarioBase;
  readonly commission: DiscountCommissionInputs;
  readonly currentPrice: Decimal;
  readonly maxPrice: Decimal;
  readonly customPrice: Decimal | null;
  readonly config: DiscountConfig;
  readonly fundingPct: Decimal;
}): ComputedCampaignItem {
  const { base, commission, currentPrice, maxPrice, customPrice, config, fundingPct } = params;

  const scenarioAt = (
    price: Decimal,
  ): { readonly settlementPrice: Decimal; readonly compute: ScenarioCompute } => {
    const { settlementPrice, bandPrice } = campaignScenarioPrices(price, config, fundingPct);
    return {
      settlementPrice,
      compute: priceScenario({ base, commission, price: settlementPrice, bandPrice }),
    };
  };

  const current = priceScenario({ base, commission, price: currentPrice, bandPrice: currentPrice });
  const max = scenarioAt(maxPrice);
  const custom = customPrice !== null ? scenarioAt(customPrice) : null;

  const basketFor = (campaignPrice: Decimal): CampaignBasketScenario | null =>
    buildCampaignBasketScenario({
      base,
      commission,
      currentPrice,
      campaignPrice,
      config,
      fundingPct,
    });

  return {
    calculable: current.calculable,
    reason: current.reason,
    current: toScenario(currentPrice, current),
    maxScenario: toScenario(max.settlementPrice, max.compute),
    customScenario: custom !== null ? toScenario(custom.settlementPrice, custom.compute) : null,
    maxBasket: basketFor(maxPrice),
    customBasket: customPrice !== null ? basketFor(customPrice) : null,
  };
}

// --- Single-scenario estimate (profit breakdown modal) ---

export interface ComputedCampaignEstimate extends ComputedScenarioEstimate {
  /** The amount the breakdown is priced at: the settlement unit at unit scope, the settlement basket at order scope. */
  readonly price: Decimal;
  readonly scope: 'unit' | 'order';
  /**
   * At order scope, the breakdown's basket framing -- the SAME block the row's max/custom card
   * shows (n, basket total, customer-paid, Trendyol-funded, order profit and the campaign-free
   * baseline). Null at unit scope.
   */
  readonly basket: CampaignBasketScenario | null;
}

/**
 * The full profit breakdown of ONE scenario. The price derivation runs the SAME path as
 * `computeCampaignItem` ({@link campaignScenarioPrices}), so the modal can never disagree with
 * the row.
 *
 * Scope follows both the config's presentation AND the scenario: on an ORDER-presentation config
 * (`BUY_X_PAY_Y` / `NTH_PRODUCT` / the conditional AMOUNT variants) the campaign scenarios return
 * an ORDER breakdown (the per-unit effective price is a synthetic average and the row's price
 * cards headline the order total), and the basket is built from that scenario's OWN price. The
 * revenue is the seller's settlement basket, not what the customer pays. The campaign-free
 * `current` scenario is ALWAYS a one-unit breakdown. Calculability, reason and commission always
 * come from the UNIT compute.
 */
export function computeCampaignEstimate(params: {
  readonly base: ScreenScenarioBase;
  readonly commission: DiscountCommissionInputs;
  /** The scenario's campaign price: the current price for `current`, else the max/custom price. */
  readonly price: Decimal;
  /** The item's current price; the basket's campaign-free baseline is priced from it. */
  readonly currentPrice: Decimal;
  readonly config: DiscountConfig;
  readonly fundingPct: Decimal;
  /** False for `current`: the seller is not joining, so no promotion and no funding apply. */
  readonly applyCampaign: boolean;
}): ComputedCampaignEstimate {
  const { base, commission, price, currentPrice, config, fundingPct, applyCampaign } = params;
  const { settlementPrice, bandPrice } = applyCampaign
    ? campaignScenarioPrices(price, config, fundingPct)
    : { settlementPrice: price, bandPrice: price };

  const computed = priceScenario({ base, commission, price: settlementPrice, bandPrice });

  // A non-positive price cannot frame a basket (n is found by dividing by the price); the row's
  // basket block is null there too, so falling back to the unit breakdown stays consistent.
  const wantOrder = applyCampaign && scenarioPresentation(config) === 'ORDER' && price.gt(ZERO);
  if (!wantOrder) {
    return {
      ...toEstimate(computed, scenarioBreakdown(computed)),
      price: settlementPrice,
      scope: 'unit',
      basket: null,
    };
  }

  const n = assumedBasketQuantity(config, price);
  const orderRevenue = toKurusHalfUp(settlementPrice).mul(n);
  // Calculability/reason/commission come from the UNIT `computed`; the breakdown is the n-unit
  // order statement, serialized at the order revenue -- the two can never disagree (toEstimate).
  const orderCompute = priceScenario({
    base,
    commission,
    price: settlementPrice,
    bandPrice,
    quantity: n,
  });
  const basket = buildCampaignBasketScenario({
    base,
    commission,
    currentPrice,
    campaignPrice: price,
    config,
    fundingPct,
  });
  return {
    ...toEstimate(computed, scenarioBreakdown(orderCompute)),
    price: orderRevenue,
    scope: 'order',
    basket,
  };
}

// --- Target-margin price suggestion ---

/** One item's inputs for the target-margin solve. */
export interface CampaignTargetMarginItem {
  readonly itemId: string;
  readonly base: ScreenScenarioBase;
  readonly commission: DiscountCommissionInputs;
  /** "Maksimum Girebileceğin Fiyat" -- the suggestion's ceiling. */
  readonly maxPrice: Decimal;
}

export interface CampaignTargetMarginInput {
  readonly items: readonly CampaignTargetMarginItem[];
  readonly config: DiscountConfig;
  readonly fundingPct: Decimal;
  /** Target net margin, percent. */
  readonly targetMarginPct: Decimal;
  /** Collects per-item engine throws; the caller flushes once per request (decision 9). */
  readonly failureLog: RequestFailureLog;
}

export interface CampaignTargetMarginSuggestion {
  readonly itemId: string;
  /** The smallest campaign price (2dp) that reaches the target; null when `reason` is set. */
  readonly price: string | null;
  readonly reason: 'UNREACHABLE' | 'NOT_CALCULABLE' | null;
}

/**
 * Suggests, per item, the smallest campaign price that reaches `targetMarginPct`. Two steps
 * (design 4.5):
 *
 *   1. The target SETTLEMENT price S: net margin is linear in the settlement, so the engine's
 *      `solveTrendyolScenarioPrice` finds S in closed form over the price breakpoints -- NEVER a
 *      binary search (project rule). The rate is resolved ONCE, from the band at the MAXIMUM
 *      price, and passed as the engine's override: the solve needs a fixed rate, but the rate
 *      depends on the band, so the highest allowed price breaks the loop. `maxUnitPrice` caps the
 *      solve at the seller's ceiling; S(P) <= P for every config (proof in campaignSearchWindow),
 *      so an S above the ceiling is never reachable.
 *   2. S back to a campaign price: `solveCampaignPriceForTarget` finds the smallest P whose
 *      settlement reaches S without exceeding the maximum, piecewise over the breakpoints (S is
 *      non-monotonic in P, so binary search would silently answer wrong).
 *
 * If the suggested price lands in a cheaper band, the row's own scenario recomputes with the real
 * rate ("optimistic estimate, settlement reconciles"). `NOT_CALCULABLE`: unmatched / degraded /
 * no resolvable commission / no computable statement. `UNREACHABLE`: a real but unmet target, or a
 * price above the maximum. This COMPUTES and RETURNS -- it writes nothing (selection persistence
 * happens at "Kaydet ve Indir", design 6).
 */
export function suggestTargetMarginPrices(
  input: CampaignTargetMarginInput,
): CampaignTargetMarginSuggestion[] {
  const { items, config, fundingPct, targetMarginPct, failureLog } = input;

  return items.map((item): CampaignTargetMarginSuggestion => {
    const notCalculable = { itemId: item.itemId, price: null, reason: 'NOT_CALCULABLE' } as const;
    const unreachable = { itemId: item.itemId, price: null, reason: 'UNREACHABLE' } as const;

    // A degraded base (store-wide load failed, already logged) or an unmatched product cannot
    // be solved.
    if (item.base.kind !== 'ready') return notCalculable;

    const { bandPrice } = campaignScenarioPrices(item.maxPrice, config, fundingPct);
    const resolved = resolveDiscountCommission(item.commission, bandPrice.toDecimalPlaces(2));
    if (resolved === null) return notCalculable;

    // A maximum below one kurus is the solver's RangeError territory -- refuse before calling it.
    const maxUnitPrice = item.maxPrice.toDecimalPlaces(2, Decimal.ROUND_DOWN);
    if (maxUnitPrice.lt(MIN_SCENARIO_UNIT_PRICE)) return unreachable;

    try {
      const solved = solveTrendyolScenarioPrice({
        base: { ...item.base.base, commissionRatePctOverride: resolved.pct },
        target: { kind: 'MARGIN', pct: targetMarginPct },
        maxUnitPrice,
      });
      if (!solved.ok) {
        // No computable statement at any price -> NOT_CALCULABLE; any real-but-unreachable
        // failure (UNREACHABLE_TARGET / NOT_PRICE_SENSITIVE / NO_COST) -> UNREACHABLE (plan).
        return solved.reason === 'NOT_COMPUTABLE' ? notCalculable : unreachable;
      }

      const campaignPrice = solveCampaignPriceForTarget(
        config,
        fundingPct,
        solved.unitPrice,
        item.maxPrice,
      );
      if (campaignPrice === null) return unreachable;

      return { itemId: item.itemId, price: campaignPrice.toFixed(2), reason: null };
    } catch (err) {
      failureLog.record(err);
      return notCalculable;
    }
  });
}
