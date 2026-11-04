import { Decimal } from 'decimal.js';
import {
  ProfitIssueCode,
  ProfitLineCertainty,
  ProfitLineSource,
  ProfitLineType,
  ProfitStatus,
  ReconciliationStatus,
} from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { makeLine } from '../../__tests__/helpers/make-profit-line';
import { PROFIT_ENGINE_VERSION } from '../engine-version';
import { type ProfitLine } from '../profit-line';
import {
  computeProfitStatement,
  type ProfitStatement,
  type ProfitStatementInput,
} from '../profit-statement';

const SETTINGS = { includeStopaj: true, includeNegativeNetVat: false };
const statementOf = (lines: ProfitLine[], overrides: Partial<ProfitStatementInput> = {}) =>
  computeProfitStatement({
    lines,
    view: 'BEST_KNOWN',
    settings: SETTINGS,
    isExportSale: false,
    isCancelled: false,
    isExcluded: false,
    issues: [],
    ...overrides,
  });
const basic = (): ProfitLine[] => [
  makeLine({ type: ProfitLineType.SALE, gross: '120', vat: '20' }),
  makeLine({
    type: ProfitLineType.COST_COGS,
    gross: '60',
    vat: '10',
    certainty: ProfitLineCertainty.ACTUAL,
    source: ProfitLineSource.SELLER_INPUT,
  }),
  makeLine({ type: ProfitLineType.COMMISSION, gross: '12', vat: '2' }),
  makeLine({ type: ProfitLineType.SHIPPING, gross: '6', vat: '1' }),
  makeLine({ type: ProfitLineType.STOPPAGE, gross: '1' }),
];
const includedSum = (s: ProfitStatement) =>
  s.rows
    .filter((r) => r.includedInProfit)
    .reduce((acc, r) => acc.add(r.signedGross), new Decimal(0));

describe('computeProfitStatement', () => {
  it('computes net profit from rows minus effective net VAT', () => {
    const s = statementOf(basic());
    expect(s.rows.map((r) => [r.type, r.signedGross.toFixed(2)])).toEqual([
      ['SALE', '120.00'],
      ['COST_COGS', '-60.00'],
      ['COMMISSION', '-12.00'],
      ['SHIPPING', '-6.00'],
      ['STOPPAGE', '-1.00'],
    ]);
    expect(s.vat.net.toFixed(2)).toBe('7.00');
    expect(s.netProfit?.toFixed(2)).toBe('34.00');
    expect(s.saleMarginPct?.toFixed(2)).toBe('28.33');
    expect(s.costMarkupPct?.toFixed(2)).toBe('56.67');
    expect(s.engineVersion).toBe(PROFIT_ENGINE_VERSION);
  });
  it('keeps the stoppage row but leaves it out of profit when includeStopaj is off', () => {
    const s = statementOf(basic(), {
      settings: { includeStopaj: false, includeNegativeNetVat: false },
    });
    expect(s.rows.find((r) => r.type === 'STOPPAGE')?.includedInProfit).toBe(false);
    expect(s.stoppageGross.toFixed(2)).toBe('1.00');
    expect(s.netProfit?.toFixed(2)).toBe('35.00');
  });
  it('returns null profit and margins when a blocking issue exists', () => {
    const s = statementOf(basic(), {
      issues: [{ code: ProfitIssueCode.MISSING_COST, orderItemId: 'item-1', detail: null }],
    });
    expect(s.status).toBe(ProfitStatus.NOT_COMPUTABLE);
    expect(s.netProfit).toBeNull();
    expect(s.saleMarginPct).toBeNull();
  });
  it('leaves the net profit and the margins empty for an excluded order', () => {
    // An excluded order keeps its full set of cost lines, yet its net profit is
    // permanently kept out of every figure (Berkin 2026-11-03). Only the revenue
    // and the other totals still compute, exactly as for a normal order.
    const s = statementOf(basic(), { isExcluded: true });
    expect(s.status).toBe(ProfitStatus.EXCLUDED);
    expect(s.saleGross.toFixed(2)).toBe('120.00');
    expect(s.costGross.toFixed(2)).toBe('60.00');
    expect(s.vat.output.toFixed(2)).toBe('20.00');
    expect(s.vat.input.toFixed(2)).toBe('13.00');
    expect(s.vat.net.toFixed(2)).toBe('7.00');
    expect(s.vat.effective.toFixed(2)).toBe('7.00');
    expect(s.stoppageGross.toFixed(2)).toBe('1.00');
    expect(s.netProfit).toBeNull();
    expect(s.saleMarginPct).toBeNull();
    expect(s.costMarkupPct).toBeNull();
  });
  it('the ESTIMATE view ignores the cargo invoice actual', () => {
    const lines = [
      ...basic(),
      makeLine({
        type: ProfitLineType.SHIPPING,
        gross: '9',
        vat: '1.50',
        certainty: ProfitLineCertainty.ACTUAL,
        source: ProfitLineSource.CARGO_INVOICE,
      }),
    ];
    expect(statementOf(lines).netProfit?.toFixed(2)).toBe('31.50');
    expect(statementOf(lines, { view: 'ESTIMATE' }).netProfit?.toFixed(2)).toBe('34.00');
  });
  it('keeps the estimate view NOT_SETTLED even when actual lines exist', () => {
    // A settlement-sourced actual lifts the best-known view off NOT_SETTLED, but the
    // estimate view never selects actuals, so it stays NOT_SETTLED on the same lines.
    const lines = [
      ...basic(),
      makeLine({
        type: ProfitLineType.SHIPPING,
        gross: '9',
        vat: '1.50',
        certainty: ProfitLineCertainty.ACTUAL,
        source: ProfitLineSource.CARGO_INVOICE,
      }),
    ];
    expect(statementOf(lines).reconciliationStatus).not.toBe(ReconciliationStatus.NOT_SETTLED);
    expect(statementOf(lines, { view: 'ESTIMATE' }).reconciliationStatus).toBe(
      ReconciliationStatus.NOT_SETTLED,
    );
  });
  it('included rows minus effective VAT always equal net profit', () => {
    for (const s of [
      statementOf(basic()),
      statementOf(basic(), { settings: { includeStopaj: false, includeNegativeNetVat: true } }),
    ]) {
      expect(
        includedSum(s)
          .sub(s.vat.effective)
          .equals(s.netProfit ?? new Decimal(NaN)),
      ).toBe(true);
    }
  });
});
