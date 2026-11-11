import {
  ProfitIssueCode,
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  ProfitStatus,
  ProfitLineType,
  ReconciliationStatus,
} from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { makeLine, type MakeLineParams } from '../../__tests__/helpers/make-profit-line';
import { PROFIT_ISSUE_CATALOG, type ProfitIssue } from '../profit-issue';
import { deriveProfitStatus, deriveReconciliationStatus } from '../profit-status';
import { type ProfitLine } from '../profit-line';

const actual = (type: ProfitLineType, extra: Partial<MakeLineParams> = {}): ProfitLine =>
  makeLine({
    type,
    gross: '10',
    certainty: ProfitLineCertainty.ACTUAL,
    source: ProfitLineSource.MARKETPLACE_RECORD,
    ...extra,
  });
const issue = (code: ProfitIssueCode): ProfitIssue => ({ code, orderItemId: null, detail: null });
const status = (
  selectedLines: ProfitLine[],
  issues: ProfitIssue[] = [],
  isCancelled = false,
  isExcluded = false,
): ProfitStatus => deriveProfitStatus({ selectedLines, issues, isCancelled, isExcluded });
const sellerCost = makeLine({
  type: ProfitLineType.COST_COGS,
  gross: '60',
  certainty: ProfitLineCertainty.ACTUAL,
  source: ProfitLineSource.SELLER_INPUT,
});

describe('deriveProfitStatus', () => {
  it('covers every issue code in the issue catalog', () => {
    expect(Object.keys(PROFIT_ISSUE_CATALOG).sort()).toEqual(Object.values(ProfitIssueCode).sort());
  });
  it('excluded wins over everything, cancelled wins over blocking issues', () => {
    expect(status([], [issue(ProfitIssueCode.MISSING_COST)], true, true)).toBe(
      ProfitStatus.EXCLUDED,
    );
    expect(status([], [issue(ProfitIssueCode.MISSING_COST)], true, false)).toBe(
      ProfitStatus.CANCELLED,
    );
  });
  it('a blocking issue makes the order not computable', () => {
    expect(status([sellerCost], [issue(ProfitIssueCode.MISSING_COMMISSION_RATE)])).toBe(
      ProfitStatus.NOT_COMPUTABLE,
    );
  });
  it('an unmapped record is a warning, not a block', () => {
    expect(status([sellerCost], [issue(ProfitIssueCode.UNMAPPED_MARKETPLACE_RECORD)])).toBe(
      ProfitStatus.ESTIMATED,
    );
  });
  it('estimates plus seller cost are ESTIMATED', () => {
    expect(status([makeLine({ type: ProfitLineType.SALE, gross: '120' }), sellerCost])).toBe(
      ProfitStatus.ESTIMATED,
    );
  });
  it('one marketplace actual with a pending required estimate is PARTIALLY_SETTLED', () => {
    expect(
      status([
        actual(ProfitLineType.COMMISSION),
        makeLine({ type: ProfitLineType.SHIPPING, gross: '6' }),
      ]),
    ).toBe(ProfitStatus.PARTIALLY_SETTLED);
  });
  it('all required types actual is SETTLED', () => {
    expect(
      status([
        actual(ProfitLineType.SALE),
        actual(ProfitLineType.COMMISSION),
        actual(ProfitLineType.SHIPPING, { source: ProfitLineSource.CARGO_INVOICE }),
        actual(ProfitLineType.SERVICE_FEE, { level: ProfitLineLevel.PARCEL, orderItemId: null }),
        actual(ProfitLineType.STOPPAGE),
        sellerCost,
      ]),
    ).toBe(ProfitStatus.SETTLED);
  });
});

describe('deriveReconciliationStatus', () => {
  it('reports NOT_SETTLED without a settlement-sourced actual line', () => {
    // A seller-entered ACTUAL cost line proves nothing about the marketplace.
    expect(
      deriveReconciliationStatus(
        [makeLine({ type: ProfitLineType.SALE, gross: '120' }), sellerCost],
        [],
      ),
    ).toBe(ReconciliationStatus.NOT_SETTLED);
  });
  it('reports PARTIALLY_SETTLED while a settlement-required line is still an estimate', () => {
    expect(
      deriveReconciliationStatus(
        [
          actual(ProfitLineType.COMMISSION),
          makeLine({ type: ProfitLineType.SHIPPING, gross: '6' }),
        ],
        [],
      ),
    ).toBe(ReconciliationStatus.PARTIALLY_SETTLED);
  });
  it('reports FULLY_SETTLED when every settlement-required line is actual', () => {
    expect(
      deriveReconciliationStatus(
        [
          actual(ProfitLineType.SALE),
          actual(ProfitLineType.COMMISSION),
          actual(ProfitLineType.SHIPPING, { source: ProfitLineSource.CARGO_INVOICE }),
          actual(ProfitLineType.SERVICE_FEE, { level: ProfitLineLevel.PARCEL, orderItemId: null }),
          actual(ProfitLineType.STOPPAGE),
          sellerCost,
        ],
        [],
      ),
    ).toBe(ReconciliationStatus.FULLY_SETTLED);
  });
  it('reports PARTIALLY_SETTLED while a settlement gap issue stands, even with every line actual', () => {
    // A settlement-gap issue marks a required slot the engine left without any line.
    // Even when every present line is a settlement actual, the gap holds the status
    // down so a missing cargo invoice does not read as fully reconciled.
    expect(
      deriveReconciliationStatus(
        [
          actual(ProfitLineType.SALE),
          actual(ProfitLineType.COMMISSION),
          actual(ProfitLineType.SHIPPING, { source: ProfitLineSource.CARGO_INVOICE }),
          actual(ProfitLineType.SERVICE_FEE, { level: ProfitLineLevel.PARCEL, orderItemId: null }),
          actual(ProfitLineType.STOPPAGE),
          sellerCost,
        ],
        [issue(ProfitIssueCode.SHIPPING_ESTIMATE_UNAVAILABLE)],
      ),
    ).toBe(ReconciliationStatus.PARTIALLY_SETTLED);
  });
  it('keeps NOT_SETTLED for a gap issue without any settlement actual', () => {
    // No settlement-sourced actual means nothing has reconciled yet; a standing gap
    // issue cannot lift the status above NOT_SETTLED on its own.
    expect(
      deriveReconciliationStatus(
        [makeLine({ type: ProfitLineType.SALE, gross: '120' }), sellerCost],
        [issue(ProfitIssueCode.MISSING_COMMISSION_RATE)],
      ),
    ).toBe(ReconciliationStatus.NOT_SETTLED);
  });
  it('ignores issues that are not settlement gaps', () => {
    // MISSING_COST is blocking but not a settlement gap, so with every settlement-required
    // line actual the statement still reconciles fully.
    expect(
      deriveReconciliationStatus(
        [
          actual(ProfitLineType.SALE),
          actual(ProfitLineType.COMMISSION),
          actual(ProfitLineType.SHIPPING, { source: ProfitLineSource.CARGO_INVOICE }),
          actual(ProfitLineType.SERVICE_FEE, { level: ProfitLineLevel.PARCEL, orderItemId: null }),
          actual(ProfitLineType.STOPPAGE),
          sellerCost,
        ],
        [issue(ProfitIssueCode.MISSING_COST)],
      ),
    ).toBe(ReconciliationStatus.FULLY_SETTLED);
  });
  it('does not hold reconciliation on a seller-cargo shipping estimate', () => {
    // On a Trendyol-contract store a seller-cargo-agreement shipping line never becomes
    // actual (owner decision 2026-11-10); its standing issue lets the rest of the
    // settlement reconcile fully instead of leaving the order partially settled forever.
    const lines = [
      actual(ProfitLineType.SALE),
      actual(ProfitLineType.COMMISSION),
      makeLine({
        type: ProfitLineType.SHIPPING,
        gross: '6',
        certainty: ProfitLineCertainty.ESTIMATE,
        source: ProfitLineSource.RULE,
      }),
    ];
    const sellerCargo = [issue(ProfitIssueCode.SELLER_CARGO_AGREEMENT_ESTIMATE)];

    expect(deriveReconciliationStatus(lines, sellerCargo)).toBe(ReconciliationStatus.FULLY_SETTLED);
    expect(status(lines, sellerCargo)).toBe(ProfitStatus.SETTLED);
    expect(deriveReconciliationStatus(lines, [])).toBe(ReconciliationStatus.PARTIALLY_SETTLED);
  });
  it('exempts only the shipping legs from a seller-cargo issue', () => {
    // A return-shipping estimate is exempt like the outbound one; any other pending
    // settlement-required line still holds reconciliation at PARTIALLY_SETTLED.
    const sellerCargo = [issue(ProfitIssueCode.SELLER_CARGO_AGREEMENT_ESTIMATE)];
    expect(
      deriveReconciliationStatus(
        [
          actual(ProfitLineType.SALE),
          makeLine({ type: ProfitLineType.RETURN_SHIPPING, gross: '6' }),
        ],
        sellerCargo,
      ),
    ).toBe(ReconciliationStatus.FULLY_SETTLED);
    expect(
      deriveReconciliationStatus(
        [
          actual(ProfitLineType.SALE),
          makeLine({ type: ProfitLineType.SHIPPING, gross: '6' }),
          makeLine({ type: ProfitLineType.STOPPAGE, gross: '1' }),
        ],
        sellerCargo,
      ),
    ).toBe(ReconciliationStatus.PARTIALLY_SETTLED);
  });
  it('reports progress for an excluded, cancelled or not computable parcel', () => {
    // The same lines reconcile to PARTIALLY_SETTLED regardless of the profit status
    // the order ends up with: reconciliation ignores exclusion, cancellation and issues.
    const lines = [
      actual(ProfitLineType.COMMISSION),
      makeLine({ type: ProfitLineType.SHIPPING, gross: '6' }),
    ];
    expect(status(lines, [], false, true)).toBe(ProfitStatus.EXCLUDED);
    expect(status(lines, [], true, false)).toBe(ProfitStatus.CANCELLED);
    expect(status(lines, [issue(ProfitIssueCode.MISSING_COMMISSION_RATE)])).toBe(
      ProfitStatus.NOT_COMPUTABLE,
    );
    expect(deriveReconciliationStatus(lines, [])).toBe(ReconciliationStatus.PARTIALLY_SETTLED);
  });
});
