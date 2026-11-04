import { Decimal } from 'decimal.js';
import {
  ProfitIssueCode,
  ProfitLineLevel,
  ProfitLineType,
  ProfitStatus,
  ReconciliationStatus,
} from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { makeLine } from '../../../__tests__/helpers/make-profit-line';
import { vatFromGross } from '../../../tax/tr/vat';
import { PROFIT_ENGINE_VERSION } from '../../engine-version';
import { type ProfitIssue } from '../../profit-issue';
import { type ProfitLine } from '../../profit-line';
import { computeProfitStatement, type ProfitStatement } from '../../profit-statement';
import {
  solveScenarioPrice,
  type ScenarioPriceTarget,
  type ScenarioSolveFailure,
  type ScenarioSolveResult,
} from '../solve-scenario-price';

const D = (value: string): Decimal => new Decimal(value);
const MIN = D('0.01');
const ZERO = D('0');

/** Eight trivial lines: only their count matters, setting the noise bound to 8 * 0.01. */
function eightLines(): readonly ProfitLine[] {
  return Array.from({ length: 8 }, () => makeLine({ type: ProfitLineType.SALE, gross: '1.00' }));
}

/**
 * A toy whose net profit has a tiny slope (so the solve window is very wide) and a
 * downward step at 10006.00 TL. The closed form, fit from the low samples, lands a
 * few lira below the true solution, so the centered scan misses it -- exactly the
 * case the upper-point fallback must rescue. Statements carry 8 lines (noise bound
 * 0.08) and have no VAT, so no net VAT kink interferes.
 */
function steppedTinySlopeEvaluate(): (unitPrice: Decimal) => ProfitStatement {
  const lines = eightLines();
  return (unitPrice: Decimal): ProfitStatement => {
    const base = unitPrice.mul('0.001').sub('10');
    const netProfit = unitPrice.lte(D('10006.00')) ? base.sub('0.05') : base;
    return {
      view: 'ESTIMATE',
      status: ProfitStatus.ESTIMATED,
      reconciliationStatus: ReconciliationStatus.NOT_SETTLED,
      engineVersion: PROFIT_ENGINE_VERSION,
      selectedLines: lines,
      rows: [],
      saleGross: unitPrice,
      costGross: D('10'),
      vat: { output: ZERO, input: ZERO, net: ZERO, effective: ZERO },
      stoppageGross: ZERO,
      stoppageIncluded: true,
      netProfit,
      saleMarginPct: null,
      costMarkupPct: null,
      issues: [],
    };
  };
}
const BP_200: readonly Decimal[] = [D('200')];

type ToyMissingCost = 'none' | 'below-200' | 'always';

interface ToyOptions {
  readonly withCost?: boolean; // default true
  readonly withCommissionEqualPrice?: boolean; // default false
  readonly missingCost?: ToyMissingCost; // default 'none'
}

/**
 * The plan's toy model: SALE gross P (VAT 0), COST_COGS 100.00 (VAT 0), and a
 * parcel SERVICE_FEE of 50.00 below 200 or 10.00 from 200 up. Breakpoint at 200.
 * netProfit is therefore P - 150 below 200 and P - 110 from 200 up.
 */
function toyEvaluate(options: ToyOptions = {}): (unitPrice: Decimal) => ProfitStatement {
  const withCost = options.withCost ?? true;
  const withCommission = options.withCommissionEqualPrice ?? false;
  const missingCost = options.missingCost ?? 'none';
  return (unitPrice: Decimal): ProfitStatement => {
    const lines: ProfitLine[] = [
      makeLine({ type: ProfitLineType.SALE, gross: unitPrice.toFixed(2), vat: '0' }),
    ];
    if (withCost) {
      lines.push(makeLine({ type: ProfitLineType.COST_COGS, gross: '100.00', vat: '0' }));
    }
    const serviceFee = unitPrice.lt(D('200')) ? '50.00' : '10.00';
    lines.push(
      makeLine({
        type: ProfitLineType.SERVICE_FEE,
        gross: serviceFee,
        vat: '0',
        level: ProfitLineLevel.PARCEL,
      }),
    );
    if (withCommission) {
      lines.push(
        makeLine({ type: ProfitLineType.COMMISSION, gross: unitPrice.toFixed(2), vat: '0' }),
      );
    }
    const issues: ProfitIssue[] = [];
    const flagMissing =
      missingCost === 'always' || (missingCost === 'below-200' && unitPrice.lt(D('200')));
    if (flagMissing) {
      issues.push({ code: ProfitIssueCode.MISSING_COST, orderItemId: null, detail: null });
    }
    return computeProfitStatement({
      lines,
      view: 'ESTIMATE',
      settings: { includeStopaj: true, includeNegativeNetVat: true },
      isExportSale: false,
      isCancelled: false,
      isExcluded: false,
      issues,
    });
  };
}

/**
 * The kink model: SALE gross P with real 20% VAT and a COST_COGS, no breakpoints.
 * Net VAT is negative at low prices and crosses zero once as the sale VAT grows
 * past the cost VAT, so a store that clamps negative net VAT bends the profit
 * curve at that crossing. The default 120.00 / 20.00 cost crosses at P = 120; a
 * larger cost pushes the crossing far above the open segment's second sample.
 */
function kinkEvaluate(
  includeNegativeNetVat: boolean,
  costGross = '120.00',
  costVat = '20.00',
): (unitPrice: Decimal) => ProfitStatement {
  return (unitPrice: Decimal): ProfitStatement =>
    computeProfitStatement({
      lines: [
        makeLine({
          type: ProfitLineType.SALE,
          gross: unitPrice.toFixed(2),
          vat: vatFromGross(unitPrice, D('20')).toFixed(2),
        }),
        makeLine({ type: ProfitLineType.COST_COGS, gross: costGross, vat: costVat }),
      ],
      view: 'ESTIMATE',
      settings: { includeStopaj: true, includeNegativeNetVat },
      isExportSale: false,
      isCancelled: false,
      isExcluded: false,
      issues: [],
    });
}

function expectOk(result: ScenarioSolveResult): Extract<ScenarioSolveResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`expected ok, got failure ${result.reason}`);
  }
  return result;
}

function expectFailure(result: ScenarioSolveResult): ScenarioSolveFailure {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error(`expected failure, got price ${result.unitPrice.toFixed(2)}`);
  }
  return result.reason;
}

const PROFIT = (amount: string): ScenarioPriceTarget => ({ kind: 'PROFIT', amount: D(amount) });
const MARGIN = (pct: string): ScenarioPriceTarget => ({ kind: 'MARGIN', pct: D(pct) });
const MARKUP = (pct: string): ScenarioPriceTarget => ({ kind: 'MARKUP', pct: D(pct) });

describe('solveScenarioPrice', () => {
  it('solves a profit target inside the first segment', () => {
    const result = solveScenarioPrice({
      evaluate: toyEvaluate(),
      breakpoints: BP_200,
      target: PROFIT('20'),
      minUnitPrice: MIN,
      maxUnitPrice: null,
    });
    const ok = expectOk(result);
    expect(ok.unitPrice.toFixed(2)).toBe('170.00');
    expect(ok.statement.netProfit?.toFixed(2)).toBe('20.00');
  });

  it('takes the start of a cheaper regime when the target is met there', () => {
    const result = solveScenarioPrice({
      evaluate: toyEvaluate(),
      breakpoints: BP_200,
      target: PROFIT('50'),
      minUnitPrice: MIN,
      maxUnitPrice: null,
    });
    const ok = expectOk(result);
    expect(ok.unitPrice.toFixed(2)).toBe('200.00');
    expect(ok.statement.netProfit?.toFixed(2)).toBe('90.00');
  });

  it('solves a margin target in the segment where it lands', () => {
    const result = solveScenarioPrice({
      evaluate: toyEvaluate(),
      breakpoints: BP_200,
      target: MARGIN('50'),
      minUnitPrice: MIN,
      maxUnitPrice: null,
    });
    const ok = expectOk(result);
    expect(ok.unitPrice.toFixed(2)).toBe('220.00');
  });

  it('reports an unreachable margin', () => {
    const result = solveScenarioPrice({
      evaluate: toyEvaluate(),
      breakpoints: BP_200,
      target: MARGIN('100'),
      minUnitPrice: MIN,
      maxUnitPrice: null,
    });
    expect(expectFailure(result)).toBe('UNREACHABLE_TARGET');
  });

  it('respects the maximum price', () => {
    const result = solveScenarioPrice({
      evaluate: toyEvaluate(),
      breakpoints: BP_200,
      target: MARGIN('50'),
      minUnitPrice: MIN,
      maxUnitPrice: D('210.00'),
    });
    expect(expectFailure(result)).toBe('UNREACHABLE_TARGET');
  });

  it('reports a price-insensitive profit', () => {
    const result = solveScenarioPrice({
      evaluate: toyEvaluate({ withCommissionEqualPrice: true }),
      breakpoints: BP_200,
      target: PROFIT('10'),
      minUnitPrice: MIN,
      maxUnitPrice: null,
    });
    expect(expectFailure(result)).toBe('NOT_PRICE_SENSITIVE');
  });

  it('reports NO_COST for a markup target without cost', () => {
    const result = solveScenarioPrice({
      evaluate: toyEvaluate({ withCost: false }),
      breakpoints: BP_200,
      target: MARKUP('30'),
      minUnitPrice: MIN,
      maxUnitPrice: null,
    });
    expect(expectFailure(result)).toBe('NO_COST');
  });

  it('skips segments that are not computable', () => {
    const result = solveScenarioPrice({
      evaluate: toyEvaluate({ missingCost: 'below-200' }),
      breakpoints: BP_200,
      target: PROFIT('20'),
      minUnitPrice: MIN,
      maxUnitPrice: null,
    });
    const ok = expectOk(result);
    expect(ok.unitPrice.toFixed(2)).toBe('200.00');
  });

  it('reports NOT_COMPUTABLE when every segment is', () => {
    const result = solveScenarioPrice({
      evaluate: toyEvaluate({ missingCost: 'always' }),
      breakpoints: BP_200,
      target: PROFIT('20'),
      minUnitPrice: MIN,
      maxUnitPrice: null,
    });
    expect(expectFailure(result)).toBe('NOT_COMPUTABLE');
  });

  it('falls back to the guaranteed upper point when the centered scan misses', () => {
    const result = solveScenarioPrice({
      evaluate: steppedTinySlopeEvaluate(),
      breakpoints: [],
      target: PROFIT('0'),
      minUnitPrice: MIN,
      maxUnitPrice: null,
    });
    const ok = expectOk(result);
    expect(ok.statement.netProfit?.gte(ZERO)).toBe(true);
    expect(ok.unitPrice.gt(D('10006.00'))).toBe(true);
  });

  it('splits at the net VAT zero crossing when the store clamps negative net VAT', () => {
    const clamped = solveScenarioPrice({
      evaluate: kinkEvaluate(false),
      breakpoints: [],
      target: PROFIT('-10'),
      minUnitPrice: MIN,
      maxUnitPrice: null,
    });
    const clampedOk = expectOk(clamped);
    expect(clampedOk.unitPrice.toFixed(2)).toBe('110.00');
    expect(clampedOk.statement.netProfit?.toFixed(2)).toBe('-10.00');

    const unclamped = solveScenarioPrice({
      evaluate: kinkEvaluate(true),
      breakpoints: [],
      target: PROFIT('-10'),
      minUnitPrice: MIN,
      maxUnitPrice: null,
    });
    const unclampedOk = expectOk(unclamped);
    expect(unclampedOk.unitPrice.toFixed(2)).toBe('108.00');
    expect(unclampedOk.statement.netProfit?.toFixed(2)).toBe('-10.00');
  });

  it('finds a solution beyond a net VAT kink that lies past the second sample of an open segment', () => {
    // Cost 1200.00 / VAT 200.00 pushes the net VAT crossing to P = 1200, well past
    // the open segment's second sample at start + 1000. Above the crossing the
    // clamped profit (5/6)P - 1000 meets a 20% margin at 30000/19 -> 1578.95.
    const result = solveScenarioPrice({
      evaluate: kinkEvaluate(false, '1200.00', '200.00'),
      breakpoints: [],
      target: MARGIN('20'),
      minUnitPrice: MIN,
      maxUnitPrice: null,
    });
    const ok = expectOk(result);
    expect(ok.unitPrice.toFixed(2)).toBe('1578.95');
    expect(ok.statement.netProfit?.toFixed(2)).toBe('315.79');
  });
});
