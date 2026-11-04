import { Decimal } from 'decimal.js';
import { CostProfileType, ProfitLineType } from '@pazarsync/db/enums';
import { type ResolvedProfitSettings } from '@pazarsync/utils';
import { describe, expect, it } from 'vitest';

import { arasmpScenarioReference } from '../../../__tests__/fixtures/trendyol-reference';
import { type ProfitLine } from '../../../core/profit-line';
import { type ProfitStatement } from '../../../core/profit-statement';
import { type ScenarioSolveResult } from '../../../core/scenario/solve-scenario-price';
import { type ItemCostProfileInput } from '../../../core/seller-costs/build-seller-cost-lines';
import { grossToVat } from '../../../money';
import { type ProfitInputFee } from '../../../profit-formula';
import { computeUnitProfit, type UnitEconomics } from '../../../unit-pricing';
import { trendyolBandForPrice } from '../resolve-commission-rate';
import {
  evaluateTrendyolScenario,
  solveTrendyolScenarioPrice,
  trendyolScenarioBreakpoints,
  type TrendyolScenarioBase,
  type TrendyolScenarioProduct,
  type TrendyolScenarioResult,
} from '../scenario';
import { type TrendyolCommissionBand } from '../trendyol-inputs';

/**
 * Golden tests that pin the profit-engine audit report's worked examples (B1, B2,
 * B3) to the rebuilt Trendyol scenario and its price solver, plus a kurus-level
 * comparison against the old scenario engine (`computeUnitProfit`) where none of
 * those audit corrections apply. Every expected value is a kurus a real order
 * would produce; the reference is the audit fixture `arasmpScenarioReference`.
 *
 * The default scenario is built locally so this file stands on its own: sale VAT
 * 20, desi 2, physical, category '369', no bands and no synced rate; fast
 * delivery, quantity 1, not export; the store includes stopaj and negative net
 * VAT; the date is 2026-10-29. The default cost is one COGS profile of 150.00 TRY
 * at 20% VAT unless a test overrides it.
 */

const SCENARIO_DATE = new Date('2026-10-29T09:00:00Z');
const ONE_KURUS = new Decimal('0.01');

const INCLUDE_NEGATIVE: ResolvedProfitSettings = {
  includeStopaj: true,
  includeNegativeNetVat: true,
};

/** The audit's three-band tariff: [300, -] = 19%, [250, 300] = 15%, [-, 250] = 12%. */
const B3_BANDS: readonly TrendyolCommissionBand[] = [
  { lowerLimit: new Decimal('300'), upperLimit: null, ratePct: new Decimal('19') },
  { lowerLimit: new Decimal('250'), upperLimit: new Decimal('300'), ratePct: new Decimal('15') },
  { lowerLimit: null, upperLimit: new Decimal('250'), ratePct: new Decimal('12') },
];

function scenarioProduct(
  overrides: Partial<TrendyolScenarioProduct> = {},
): TrendyolScenarioProduct {
  return {
    variantId: 'variant-scenario',
    barcode: 'bc-scenario',
    saleVatRatePct: new Decimal('20'),
    unitDesi: new Decimal('2'),
    isDigital: false,
    categoryId: '369',
    brandId: null,
    syncedCommissionRatePct: null,
    tariffBands: null,
    ...overrides,
  };
}

/** One COGS profile, 20% VAT by default, effective well before the scenario date. */
function cogsProfiles(amountGross: string, vatRatePct = '20'): ItemCostProfileInput[] {
  return [
    {
      profileId: 'cogs-scenario',
      profileType: CostProfileType.COGS,
      versions: [
        {
          effectiveFrom: new Date('2026-01-01T00:00:00Z'),
          versionNumber: 1,
          amountGross: new Decimal(amountGross),
          vatRatePct: new Decimal(vatRatePct),
          archivedAt: null,
        },
      ],
    },
  ];
}

interface ScenarioOverrides {
  readonly product?: Partial<TrendyolScenarioProduct>;
  readonly costs?: readonly ItemCostProfileInput[];
  readonly commissionRatePctOverride?: Decimal | null;
}

/** The default scenario base (no unit price); the default cost is 150.00 TRY at 20% VAT. */
function scenarioBase(overrides: ScenarioOverrides = {}): TrendyolScenarioBase {
  return {
    product: scenarioProduct(overrides.product),
    quantity: 1,
    commissionRatePctOverride: overrides.commissionRatePctOverride ?? null,
    scenarioDate: SCENARIO_DATE,
    fastDelivery: true,
    isExportSale: false,
    reference: arasmpScenarioReference(),
    costs: overrides.costs ?? cogsProfiles('150'),
    settings: INCLUDE_NEGATIVE,
  };
}

/** Evaluates the default scenario at one unit price, with per-field overrides. */
function evaluateAt(unitPrice: Decimal, overrides: ScenarioOverrides = {}): TrendyolScenarioResult {
  return evaluateTrendyolScenario({ ...scenarioBase(overrides), unitPrice });
}

/** Narrows a solve result to its success branch, failing the test otherwise. */
function requireSolved(result: ScenarioSolveResult): {
  readonly unitPrice: Decimal;
  readonly statement: ProfitStatement;
} {
  if (!result.ok) {
    throw new Error(`expected a solved price, got ${result.reason}`);
  }
  return result;
}

/** Finds the single line of a type; the one-item scenario has at most one per type. */
function requireLine(lines: readonly ProfitLine[], type: ProfitLineType): ProfitLine {
  const line = lines.find((candidate) => candidate.type === type);
  if (line === undefined) {
    throw new Error(`missing ${type} line`);
  }
  return line;
}

/**
 * How many kurus below the solved price the sweep still covers point by point. The
 * solver corrects a closed-form candidate against per-line rounding noise over a few
 * kurus (`3 * noiseBound / slope`, a couple of kurus for these scenarios); this window
 * is several times that, so it still catches a solver that returns a price a hair above
 * the lowest because a fixed nudge is narrower than the rounding noise.
 */
const LOWEST_MARGIN_NOISE_WINDOW = 12;

/**
 * Asserts the solver returns the global lowest unit price that meets `pct`: the solved
 * price meets the margin, and no lower price does. Rather than sweeping a hundred blind
 * kurus (which only ever rebuilt the same answer), it samples the two places a solver
 * can err -- a rounding-noise window just below the solved price, and every Barem or
 * commission breakpoint below the solved price with the kurus either side, where a
 * cheaper band could otherwise sneak a meeting price in under the answer. Same claim,
 * a handful of evaluations instead of a hundred.
 */
function expectLowestMargin(pct: string, overrides: ScenarioOverrides = {}): void {
  const pctValue = new Decimal(pct);
  const base = scenarioBase(overrides);
  const solved = requireSolved(
    solveTrendyolScenarioPrice({ base, target: { kind: 'MARGIN', pct: pctValue } }),
  );
  expect(solved.statement.saleMarginPct?.gte(pctValue)).toBe(true);

  const prices: Decimal[] = [];
  for (let step = 1; step <= LOWEST_MARGIN_NOISE_WINDOW; step++) {
    prices.push(solved.unitPrice.sub(ONE_KURUS.mul(step)));
  }
  for (const breakpoint of trendyolScenarioBreakpoints(base)) {
    if (breakpoint.lt(solved.unitPrice)) {
      prices.push(breakpoint.sub(ONE_KURUS), breakpoint);
    }
  }

  for (const price of prices) {
    if (price.lt(ONE_KURUS)) {
      continue;
    }
    const margin = evaluateTrendyolScenario({ ...base, unitPrice: price }).statement.saleMarginPct;
    expect(margin === null || margin.lt(pctValue), price.toFixed(2)).toBe(true);
  }
}

describe('golden audit scenarios', () => {
  it('B1: a zero-VAT cost gives the real order profit', () => {
    const result = evaluateAt(new Decimal('1000.00'), { costs: cogsProfiles('500.00', '0') });

    const shipping = requireLine(result.estimate.lines, ProfitLineType.SHIPPING);
    expect(shipping.amount.gross.toFixed(2)).toBe('100.72');
    expect(shipping.amount.vat.toFixed(2)).toBe('16.79');
    expect(shipping.inputs.tariffKind).toBe('DESI');

    expect(result.statement.netProfit?.toFixed(2)).toBe('63.41');
  });

  it('B2: a campaign price below the Barem threshold keeps its profit', () => {
    const result = evaluateAt(new Decimal('299.00'), { costs: cogsProfiles('130.00') });
    expect(result.statement.netProfit?.toFixed(2)).toBe('3.79');
  });

  it('returns the lowest price for a 50% margin', () => {
    const solved = requireSolved(
      solveTrendyolScenarioPrice({
        base: scenarioBase(),
        target: { kind: 'MARGIN', pct: new Decimal('50') },
      }),
    );
    expect(solved.unitPrice.toFixed(2)).toBe('1388.90');
  });

  it('returns the lowest price for a 20% margin with a zero-VAT cost', () => {
    const solved = requireSolved(
      solveTrendyolScenarioPrice({
        base: scenarioBase({ costs: cogsProfiles('500', '0') }),
        target: { kind: 'MARGIN', pct: new Decimal('20') },
      }),
    );
    expect(solved.unitPrice.toFixed(2)).toBe('1298.00');
  });

  it('never calls a reachable margin unreachable under a 40% commission', () => {
    // Two reachable margins bracket the range: a low one and a high one that solves far
    // up the open-ended top segment, where a solver is most tempted to call a reachable
    // margin unreachable. Both solve above the Barem edges, and `expectLowestMargin`
    // samples every breakpoint below the answer, so the three middling margins dropped
    // here only re-ran the same open-segment solve at a different height (and the
    // unreachable path has its own test above).
    const overrides: ScenarioOverrides = { commissionRatePctOverride: new Decimal('40') };
    for (const pct of ['33.6', '40.4']) {
      expectLowestMargin(pct, overrides);
    }
  });

  it('never calls a reachable margin unreachable under the default commission', () => {
    for (const pct of ['61.0', '62.3', '64.5']) {
      expectLowestMargin(pct);
    }
  });

  it('B2: solves a 20% margin across the Barem bands', () => {
    const solved = requireSolved(
      solveTrendyolScenarioPrice({
        base: scenarioBase(),
        target: { kind: 'MARGIN', pct: new Decimal('20') },
      }),
    );
    expect(solved.unitPrice.toFixed(2)).toBe('479.83');
    expect(solved.statement.netProfit?.toFixed(2)).toBe('95.97');

    const below = evaluateAt(new Decimal('479.82'));
    expect(below.statement.saleMarginPct?.lt(20)).toBe(true);

    const oldAnswer = evaluateAt(new Decimal('457.60'));
    expect(oldAnswer.statement.netProfit?.toFixed(2)).toBe('81.33');
    expect(oldAnswer.statement.saleMarginPct?.toFixed(2)).toBe('17.77');
  });

  it('solves a profit target', () => {
    const solved = requireSolved(
      solveTrendyolScenarioPrice({
        base: scenarioBase(),
        target: { kind: 'PROFIT', amount: new Decimal('50.00') },
      }),
    );
    expect(solved.unitPrice.toFixed(2)).toBe('410.00');
    expect(solved.statement.netProfit?.toFixed(2)).toBe('50.00');

    const below = evaluateAt(new Decimal('409.99'));
    expect(below.statement.netProfit?.toFixed(2)).toBe('49.99');
  });

  it('solves a markup target', () => {
    const solved = requireSolved(
      solveTrendyolScenarioPrice({
        base: scenarioBase(),
        target: { kind: 'MARKUP', pct: new Decimal('30') },
      }),
    );
    expect(solved.unitPrice.toFixed(2)).toBe('402.41');
    expect(solved.statement.netProfit?.toFixed(2)).toBe('45.00');

    const below = evaluateAt(new Decimal('402.40'));
    expect(below.statement.netProfit?.toFixed(2)).toBe('44.99');
  });

  it('reports an unreachable margin', () => {
    const result = solveTrendyolScenarioPrice({
      base: scenarioBase(),
      target: { kind: 'MARGIN', pct: new Decimal('70') },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected no solved price');
    }
    expect(result.reason).toBe('UNREACHABLE_TARGET');
  });

  it('reports NOT_COMPUTABLE without a cost', () => {
    const result = solveTrendyolScenarioPrice({
      base: scenarioBase({ costs: [] }),
      target: { kind: 'MARGIN', pct: new Decimal('20') },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected no solved price');
    }
    expect(result.reason).toBe('NOT_COMPUTABLE');
  });

  it('B3: picks the commission band of the solved price', () => {
    const solved = requireSolved(
      solveTrendyolScenarioPrice({
        base: scenarioBase({ product: { tariffBands: B3_BANDS } }),
        target: { kind: 'MARGIN', pct: new Decimal('20') },
      }),
    );

    const commission = requireLine(solved.statement.selectedLines, ProfitLineType.COMMISSION);
    expect(commission.inputs.rateSource).toBe('TARIFF_BAND');

    const band = trendyolBandForPrice(B3_BANDS, solved.unitPrice);
    expect(band).not.toBeNull();
    if (band === null) {
      throw new Error('no band contains the solved price');
    }
    expect(commission.inputs.ratePct).toBe(band.ratePct.toString());

    // The solved price meets the 20% margin; one kurus lower does not.
    expect(solved.statement.saleMarginPct?.gte(20)).toBe(true);
    const below = evaluateAt(solved.unitPrice.sub(ONE_KURUS), {
      product: { tariffBands: B3_BANDS },
    });
    expect(below.statement.saleMarginPct?.lt(20)).toBe(true);
  });

  it('matches the old scenario engine within a few kurus where B1, B2 and B3 do not apply', () => {
    const vatRate = new Decimal('20');
    const shippingGross = new Decimal('100.72');
    const platformServiceGross = new Decimal('13.19');
    const fixedFees: ProfitInputFee[] = [
      {
        type: 'SHIPPING',
        gross: shippingGross,
        vat: grossToVat(shippingGross, vatRate),
        direction: 'DEBIT',
      },
      {
        type: 'PLATFORM_SERVICE',
        gross: platformServiceGross,
        vat: grossToVat(platformServiceGross, vatRate),
        direction: 'DEBIT',
      },
    ];
    const costGross = new Decimal('150.00');
    const econ: UnitEconomics = {
      saleVatRate: vatRate,
      cost: { gross: costGross, vat: grossToVat(costGross, vatRate) },
      commissionRate: new Decimal('20'),
      commissionVatRate: vatRate,
      stoppageRate: new Decimal('0.01'),
      fixedFees,
    };

    const tolerance = new Decimal('0.03');
    for (const price of ['360.00', '400.00', '500.00', '750.00', '1000.00']) {
      const unitPrice = new Decimal(price);
      const newNetProfit = evaluateAt(unitPrice).statement.netProfit;
      if (newNetProfit === null) {
        throw new Error(`scenario netProfit is null at ${price}`);
      }
      const oldNetProfit = computeUnitProfit(econ, unitPrice).netProfit;
      expect(newNetProfit.sub(oldNetProfit).abs().lte(tolerance)).toBe(true);
    }
  });
});
