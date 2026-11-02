import { Decimal } from 'decimal.js';
import {
  CostProfileType,
  ProfitLineType,
  ProfitStatus,
  ShippingTariffSource,
} from '@pazarsync/db/enums';
import { type ResolvedProfitSettings } from '@pazarsync/utils';
import { describe, expect, it } from 'vitest';

import { arasmpScenarioReference } from '../../../__tests__/fixtures/trendyol-reference';
import { type ProfitLine } from '../../../core/profit-line';
import { type ItemCostProfileInput } from '../../../core/seller-costs/build-seller-cost-lines';
import {
  buildTrendyolScenarioParcel,
  evaluateTrendyolScenario,
  solveTrendyolScenarioPrice,
  trendyolScenarioBreakpoints,
  TRENDYOL_SCENARIO_ITEM_ID,
  TRENDYOL_SCENARIO_PARCEL_ID,
  type TrendyolScenarioBase,
  type TrendyolScenarioInput,
  type TrendyolScenarioProduct,
} from '../scenario';
import { type TrendyolCommissionBand, type TrendyolReferenceData } from '../trendyol-inputs';

/**
 * Trendyol scenario tests. The scenario is a hypothetical one-item parcel run through
 * the Phase 2A module and the Phase 1 statement, so every expected value below is the
 * same kurus an identical real order would produce. The reference is the audit
 * fixture `arasmpScenarioReference` (ARASMP carrier, Barem 42.91 / 73.74, desi '2' 83.93).
 */

const SCENARIO_DATE = new Date('2026-10-29T09:00:00Z');
const INCLUDE_NEGATIVE: ResolvedProfitSettings = {
  includeStopaj: true,
  includeNegativeNetVat: true,
};
const CLAMP_NEGATIVE: ResolvedProfitSettings = {
  includeStopaj: true,
  includeNegativeNetVat: false,
};

/** The three-band tariff of the "band of the asked price" cases: [300,-]=19, [250,300]=15, [-,250]=12. */
const THREE_BANDS: readonly TrendyolCommissionBand[] = [
  { lowerLimit: new Decimal('300'), upperLimit: null, ratePct: new Decimal('19') },
  { lowerLimit: new Decimal('250'), upperLimit: new Decimal('300'), ratePct: new Decimal('15') },
  { lowerLimit: null, upperLimit: new Decimal('250'), ratePct: new Decimal('12') },
];

/** The default scenario product: sale VAT 20, desi 2, physical, category 369, no bands, no synced rate. */
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
  readonly quantity?: number;
  readonly commissionRatePctOverride?: Decimal | null;
  readonly fastDelivery?: boolean;
  readonly isExportSale?: boolean;
  readonly settings?: ResolvedProfitSettings;
  readonly costs?: readonly ItemCostProfileInput[];
  readonly reference?: TrendyolReferenceData;
}

/** The default scenario input at a given unit price, with per-field overrides. */
function scenarioInput(
  unitPrice: string,
  overrides: ScenarioOverrides = {},
): TrendyolScenarioInput {
  return {
    product: scenarioProduct(overrides.product),
    unitPrice: new Decimal(unitPrice),
    quantity: overrides.quantity ?? 1,
    commissionRatePctOverride: overrides.commissionRatePctOverride ?? null,
    scenarioDate: SCENARIO_DATE,
    fastDelivery: overrides.fastDelivery ?? true,
    isExportSale: overrides.isExportSale ?? false,
    reference: overrides.reference ?? arasmpScenarioReference(),
    costs: overrides.costs ?? cogsProfiles('130'),
    settings: overrides.settings ?? INCLUDE_NEGATIVE,
  };
}

/** The scenario base (no unit price); the breakpoints depend only on these fields. */
function scenarioBase(overrides: ScenarioOverrides = {}): TrendyolScenarioBase {
  return scenarioInput('1.00', overrides);
}

/** Finds the single line of a type; the one-item scenario has at most one per type. */
function requireLine(lines: readonly ProfitLine[], type: ProfitLineType): ProfitLine {
  const line = lines.find((candidate) => candidate.type === type);
  if (line === undefined) {
    throw new Error(`missing ${type} line`);
  }
  return line;
}

function breakpointsToFixed(breakpoints: readonly Decimal[]): string[] {
  return breakpoints.map((value) => value.toFixed(2));
}

describe('buildTrendyolScenarioParcel', () => {
  it('builds a one-item scenario parcel at the asked price', () => {
    const parcel = buildTrendyolScenarioParcel(scenarioInput('150.00', { quantity: 2 }));

    expect(parcel.snapshot.parcelId).toBe(TRENDYOL_SCENARIO_PARCEL_ID);
    expect(parcel.snapshot.items).toHaveLength(1);
    const [item] = parcel.snapshot.items;
    expect(item?.orderItemId).toBe(TRENDYOL_SCENARIO_ITEM_ID);
    expect(item?.listGross.toFixed(2)).toBe('300.00');
    expect(item?.saleGross.toFixed(2)).toBe('300.00');
    expect(item?.sellerDiscountGross.toFixed(2)).toBe('0.00');
  });

  it('rejects a non-positive or over-precise unit price', () => {
    expect(() => buildTrendyolScenarioParcel(scenarioInput('0'))).toThrow(RangeError);
    expect(() => buildTrendyolScenarioParcel(scenarioInput('-1.00'))).toThrow(RangeError);
    expect(() => buildTrendyolScenarioParcel(scenarioInput('10.001'))).toThrow(RangeError);
  });
});

describe('evaluateTrendyolScenario', () => {
  it('prices Barem from the asked price', () => {
    const barem = evaluateTrendyolScenario(scenarioInput('299.00'));
    const baremShipping = requireLine(barem.estimate.lines, ProfitLineType.SHIPPING);
    expect(baremShipping.amount.gross.toFixed(2)).toBe('88.49');
    expect(baremShipping.amount.vat.toFixed(2)).toBe('14.75');
    expect(baremShipping.inputs.tariffKind).toBe('BAREM');

    const desi = evaluateTrendyolScenario(scenarioInput('380.00'));
    const desiShipping = requireLine(desi.estimate.lines, ProfitLineType.SHIPPING);
    expect(desiShipping.amount.gross.toFixed(2)).toBe('100.72');
    expect(desiShipping.amount.vat.toFixed(2)).toBe('16.79');
    expect(desiShipping.inputs.tariffKind).toBe('DESI');
  });

  it('evaluates the audit sale at 299', () => {
    const result = evaluateTrendyolScenario(scenarioInput('299.00'));
    const lines = result.estimate.lines;

    const sale = requireLine(lines, ProfitLineType.SALE);
    expect(sale.amount.gross.toFixed(2)).toBe('299.00');
    expect(sale.amount.vat.toFixed(2)).toBe('49.83');

    const commission = requireLine(lines, ProfitLineType.COMMISSION);
    expect(commission.amount.gross.toFixed(2)).toBe('59.80');
    expect(commission.amount.vat.toFixed(2)).toBe('9.97');

    const cost = requireLine(lines, ProfitLineType.COST_COGS);
    expect(cost.amount.gross.toFixed(2)).toBe('130.00');
    expect(cost.amount.vat.toFixed(2)).toBe('21.67');

    const stoppage = requireLine(lines, ProfitLineType.STOPPAGE);
    expect(stoppage.amount.gross.toFixed(2)).toBe('2.49');

    const serviceFee = requireLine(lines, ProfitLineType.SERVICE_FEE);
    expect(serviceFee.amount.gross.toFixed(2)).toBe('13.19');
    expect(serviceFee.amount.vat.toFixed(2)).toBe('2.20');

    expect(result.statement.netProfit?.toFixed(2)).toBe('3.79');
    expect(result.statement.status).toBe(ProfitStatus.ESTIMATED);
  });

  it('applies the store settings like an order', () => {
    const withNegative = evaluateTrendyolScenario(
      scenarioInput('190.00', { costs: cogsProfiles('150') }),
    );
    expect(withNegative.statement.netProfit?.toFixed(2)).toBe('-53.82');

    const clamped = evaluateTrendyolScenario(
      scenarioInput('190.00', { costs: cogsProfiles('150'), settings: CLAMP_NEGATIVE }),
    );
    expect(clamped.statement.netProfit?.toFixed(2)).toBe('-64.26');
  });

  it('uses the band of the asked price, or the override', () => {
    const banded = evaluateTrendyolScenario(
      scenarioInput('280.00', { product: { tariffBands: THREE_BANDS } }),
    );
    const bandedCommission = requireLine(banded.estimate.lines, ProfitLineType.COMMISSION);
    expect(bandedCommission.amount.gross.toFixed(2)).toBe('42.00');

    const overridden = evaluateTrendyolScenario(
      scenarioInput('280.00', {
        product: { tariffBands: THREE_BANDS },
        commissionRatePctOverride: new Decimal('19'),
      }),
    );
    const overriddenCommission = requireLine(overridden.estimate.lines, ProfitLineType.COMMISSION);
    expect(overriddenCommission.amount.gross.toFixed(2)).toBe('53.20');
  });
});

describe('trendyolScenarioBreakpoints', () => {
  it('lists Barem breakpoints for one unit', () => {
    expect(breakpointsToFixed(trendyolScenarioBreakpoints(scenarioBase()))).toEqual([
      '200.00',
      '350.00',
    ]);
  });

  it('scales Barem breakpoints by quantity', () => {
    expect(breakpointsToFixed(trendyolScenarioBreakpoints(scenarioBase({ quantity: 2 })))).toEqual([
      '100.00',
      '175.00',
    ]);
  });

  it('lists commission band breakpoints unless overridden', () => {
    const base = scenarioBase({
      fastDelivery: false,
      product: { tariffBands: THREE_BANDS },
    });
    expect(breakpointsToFixed(trendyolScenarioBreakpoints(base))).toEqual([
      '250.00',
      '250.01',
      '300.00',
      '300.01',
    ]);

    const overridden = scenarioBase({
      fastDelivery: false,
      product: { tariffBands: THREE_BANDS },
      commissionRatePctOverride: new Decimal('19'),
    });
    expect(trendyolScenarioBreakpoints(overridden)).toEqual([]);
  });

  it('rounds commission band edges to kurus', () => {
    const bands: readonly TrendyolCommissionBand[] = [
      {
        lowerLimit: new Decimal('250.005'),
        upperLimit: new Decimal('299.995'),
        ratePct: new Decimal('15'),
      },
    ];
    const base = scenarioBase({ fastDelivery: false, product: { tariffBands: bands } });
    const fixed = breakpointsToFixed(trendyolScenarioBreakpoints(base));
    expect(fixed).toContain('250.01');
    expect(fixed).toContain('300.00');
  });

  it('lists no Barem breakpoints without eligibility, for digital items or own contracts', () => {
    expect(trendyolScenarioBreakpoints(scenarioBase({ fastDelivery: false }))).toEqual([]);
    expect(trendyolScenarioBreakpoints(scenarioBase({ product: { isDigital: true } }))).toEqual([]);

    const reference = arasmpScenarioReference();
    const ownContractReference: TrendyolReferenceData = {
      ...reference,
      shipping: { ...reference.shipping, source: ShippingTariffSource.OWN_CONTRACT },
    };
    expect(trendyolScenarioBreakpoints(scenarioBase({ reference: ownContractReference }))).toEqual(
      [],
    );
  });
});

describe('solveTrendyolScenarioPrice', () => {
  it('solves through the scenario with its own breakpoints', () => {
    const result = solveTrendyolScenarioPrice({
      base: scenarioBase({ costs: cogsProfiles('150') }),
      target: { kind: 'MARGIN', pct: new Decimal('20') },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`expected a solved price, got ${result.reason}`);
    }
    expect(result.unitPrice.toFixed(2)).toBe('479.83');
    expect(result.statement.netProfit?.toFixed(2)).toBe('95.97');
  });

  it('solves a basket of two units', () => {
    // unitDesi 1 keeps the basket's total desi (2) within the fixture's desi tariff tier.
    const base = scenarioBase({
      quantity: 2,
      costs: cogsProfiles('150'),
      product: { unitDesi: new Decimal('1') },
    });
    const result = solveTrendyolScenarioPrice({
      base,
      target: { kind: 'MARGIN', pct: new Decimal('20') },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`expected a solved price, got ${result.reason}`);
    }
    expect(result.statement.saleMarginPct?.gte(20)).toBe(true);
    const below = evaluateTrendyolScenario({
      ...base,
      unitPrice: result.unitPrice.sub(new Decimal('0.01')),
    });
    expect(below.statement.saleMarginPct?.lt(20)).toBe(true);
  });

  it('respects the maximum unit price', () => {
    const result = solveTrendyolScenarioPrice({
      base: scenarioBase({ costs: cogsProfiles('150') }),
      target: { kind: 'MARGIN', pct: new Decimal('20') },
      maxUnitPrice: new Decimal('450.00'),
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected no solved price');
    }
    expect(result.reason).toBe('UNREACHABLE_TARGET');
  });

  it('solves through the net VAT kink of a clamped store', () => {
    const base = scenarioBase({ costs: cogsProfiles('1200.00'), settings: CLAMP_NEGATIVE });
    const result = solveTrendyolScenarioPrice({
      base,
      target: { kind: 'MARGIN', pct: new Decimal('20') },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`expected a solved price, got ${result.reason}`);
    }
    expect(result.statement.saleMarginPct?.gte(20)).toBe(true);
    const below = evaluateTrendyolScenario({
      ...base,
      unitPrice: result.unitPrice.sub(new Decimal('0.01')),
    });
    expect(below.statement.saleMarginPct?.lt(20)).toBe(true);
  });
});
