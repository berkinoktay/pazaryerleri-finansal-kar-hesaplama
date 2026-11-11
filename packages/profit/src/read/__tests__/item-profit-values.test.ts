import { Decimal } from 'decimal.js';
import {
  ProfitIssueCode,
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  ProfitLineType,
} from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { type ProfitIssue } from '../../core/profit-issue';
import { createProfitLine, type ProfitLine } from '../../core/profit-line';
import { itemProfitValues } from '../item-profit-values';

const ITEM = 'item-a';
const OTHER_ITEM = 'item-b';

/** A product-cost expense line with a chosen VAT rate, for one item. */
function costLine(params: {
  readonly type: ProfitLineType;
  readonly orderItemId: string;
  readonly gross: string;
  readonly vatRatePct: string | null;
}): ProfitLine {
  return createProfitLine({
    type: params.type,
    level: ProfitLineLevel.ITEM,
    orderItemId: params.orderItemId,
    certainty: ProfitLineCertainty.ESTIMATE,
    source: ProfitLineSource.RULE,
    amount: { gross: new Decimal(params.gross), vat: new Decimal('0') },
    vatRatePct: params.vatRatePct === null ? null : new Decimal(params.vatRatePct),
    inputs: {},
    externalRecord: null,
  });
}

/** A commission line with a certainty/source, an optional rate input and VAT rate. */
function commissionLine(params: {
  readonly orderItemId: string;
  readonly gross: string;
  readonly certainty: ProfitLineCertainty;
  readonly source: ProfitLineSource;
  readonly ratePct?: string;
  readonly vatRatePct?: string;
}): ProfitLine {
  return createProfitLine({
    type: ProfitLineType.COMMISSION,
    level: ProfitLineLevel.ITEM,
    orderItemId: params.orderItemId,
    certainty: params.certainty,
    source: params.source,
    amount: { gross: new Decimal(params.gross), vat: new Decimal('0') },
    vatRatePct: params.vatRatePct === undefined ? null : new Decimal(params.vatRatePct),
    inputs: params.ratePct === undefined ? {} : { ratePct: params.ratePct },
    externalRecord: null,
  });
}

/** A sale-return line for one item (the accepted return reversing its sale). */
function saleReturnLine(params: {
  readonly orderItemId: string;
  readonly gross: string;
}): ProfitLine {
  return createProfitLine({
    type: ProfitLineType.SALE_RETURN,
    level: ProfitLineLevel.ITEM,
    orderItemId: params.orderItemId,
    certainty: ProfitLineCertainty.ESTIMATE,
    source: ProfitLineSource.RULE,
    amount: { gross: new Decimal(params.gross), vat: new Decimal('0') },
    vatRatePct: null,
    inputs: {},
    externalRecord: null,
  });
}

/** A commission refund line for one item (the returned item's commission given back). */
function commissionRefundLine(params: {
  readonly orderItemId: string;
  readonly gross: string;
}): ProfitLine {
  return createProfitLine({
    type: ProfitLineType.COMMISSION_REFUND,
    level: ProfitLineLevel.ITEM,
    orderItemId: params.orderItemId,
    certainty: ProfitLineCertainty.ESTIMATE,
    source: ProfitLineSource.RULE,
    amount: { gross: new Decimal(params.gross), vat: new Decimal('0') },
    vatRatePct: null,
    inputs: {},
    externalRecord: null,
  });
}

describe('itemProfitValues', () => {
  it('sums the item commission refunds from the best-known lines', () => {
    const commission = commissionLine({
      orderItemId: ITEM,
      gross: '28.00',
      certainty: ProfitLineCertainty.ESTIMATE,
      source: ProfitLineSource.RULE,
    });

    const refunded = itemProfitValues({
      orderItemId: ITEM,
      quantity: 1,
      bestKnownLines: [
        commission,
        commissionRefundLine({ orderItemId: ITEM, gross: '28.00' }),
        // Another item's refund must not count toward this item.
        commissionRefundLine({ orderItemId: OTHER_ITEM, gross: '10.00' }),
      ],
      estimateLines: [],
      issues: [],
    });
    expect(refunded.refundedCommissionGross).toBe('28.00');

    // No refund line for the item: zero, even when another item carries one.
    const notRefunded = itemProfitValues({
      orderItemId: ITEM,
      quantity: 1,
      bestKnownLines: [
        commission,
        commissionRefundLine({ orderItemId: OTHER_ITEM, gross: '10.00' }),
      ],
      estimateLines: [],
      issues: [],
    });
    expect(notRefunded.refundedCommissionGross).toBe('0.00');
  });

  it('reports zero commission and refund when no line supplies them and no issue applies', () => {
    // A cancelled order: the lines carry no commission and nothing blocks the item.
    const values = itemProfitValues({
      orderItemId: ITEM,
      quantity: 1,
      bestKnownLines: [],
      estimateLines: [],
      issues: [],
    });
    expect(values.commissionGross).toBe('0.00');
    expect(values.refundedCommissionGross).toBe('0.00');
    expect(values.estimatedCommissionGross).toBeNull();
    expect(values.settledCommissionGross).toBeNull();
  });

  it('reports a null commission when a MISSING_COMMISSION_RATE issue names the item', () => {
    const issues: ProfitIssue[] = [
      { code: ProfitIssueCode.MISSING_COMMISSION_RATE, orderItemId: ITEM, detail: null },
    ];
    const named = itemProfitValues({
      orderItemId: ITEM,
      quantity: 1,
      bestKnownLines: [],
      estimateLines: [],
      issues,
    });
    expect(named.commissionGross).toBeNull();
    // Not returned: there is nothing to give back, so the refund is a known zero.
    expect(named.refundedCommissionGross).toBe('0.00');
    expect(named.commissionRate).toBeNull();
    expect(named.estimatedCommissionGross).toBeNull();
    expect(named.settledCommissionGross).toBeNull();

    // The same issue naming another item leaves this item at a plain zero commission.
    const other = itemProfitValues({
      orderItemId: OTHER_ITEM,
      quantity: 1,
      bestKnownLines: [],
      estimateLines: [],
      issues,
    });
    expect(other.commissionGross).toBe('0.00');
    expect(other.refundedCommissionGross).toBe('0.00');
  });

  it('treats a parcel-wide missing commission rate as missing for every item', () => {
    const issues: ProfitIssue[] = [
      { code: ProfitIssueCode.MISSING_COMMISSION_RATE, orderItemId: null, detail: null },
    ];
    for (const orderItemId of [ITEM, OTHER_ITEM]) {
      const values = itemProfitValues({
        orderItemId,
        quantity: 1,
        bestKnownLines: [],
        estimateLines: [],
        issues,
      });
      expect(values.commissionGross).toBeNull();
      expect(values.refundedCommissionGross).toBe('0.00');
    }
  });

  it('reports a null commission refund for a returned item whose commission is unknown', () => {
    // The customer returned the item, the rate never resolved, so the engine wrote neither a
    // commission nor a refund line: the refund owed is unknown, not zero.
    const issues: ProfitIssue[] = [
      { code: ProfitIssueCode.MISSING_COMMISSION_RATE, orderItemId: ITEM, detail: null },
    ];
    const returned = itemProfitValues({
      orderItemId: ITEM,
      quantity: 1,
      bestKnownLines: [saleReturnLine({ orderItemId: ITEM, gross: '140.00' })],
      estimateLines: [],
      issues,
    });
    expect(returned.commissionGross).toBeNull();
    expect(returned.refundedCommissionGross).toBeNull();

    // Once the settlement brings the sale's real commission the refund is a known zero
    // until its own record lands (the commission is known, only the refund line is pending).
    const settledSale = itemProfitValues({
      orderItemId: ITEM,
      quantity: 1,
      bestKnownLines: [
        saleReturnLine({ orderItemId: ITEM, gross: '140.00' }),
        commissionLine({
          orderItemId: ITEM,
          gross: '28.00',
          certainty: ProfitLineCertainty.ACTUAL,
          source: ProfitLineSource.MARKETPLACE_RECORD,
        }),
      ],
      estimateLines: [],
      issues,
    });
    expect(settledSale.commissionGross).toBe('28.00');
    expect(settledSale.refundedCommissionGross).toBe('0.00');
  });

  it('reports the settled commission even while a MISSING_COMMISSION_RATE issue covers the item', () => {
    // The engine priced no estimate commission, but the settlement brought the real one:
    // the line wins over the issue, and the commission is known, so no refund reads zero.
    const values = itemProfitValues({
      orderItemId: ITEM,
      quantity: 1,
      bestKnownLines: [
        commissionLine({
          orderItemId: ITEM,
          gross: '30.00',
          certainty: ProfitLineCertainty.ACTUAL,
          source: ProfitLineSource.MARKETPLACE_RECORD,
        }),
      ],
      estimateLines: [],
      issues: [{ code: ProfitIssueCode.MISSING_COMMISSION_RATE, orderItemId: ITEM, detail: null }],
    });
    expect(values.commissionGross).toBe('30.00');
    expect(values.settledCommissionGross).toBe('30.00');
    expect(values.refundedCommissionGross).toBe('0.00');
    // The estimate view has no commission line, so neither an estimate nor a rate exists.
    expect(values.estimatedCommissionGross).toBeNull();
    expect(values.commissionRate).toBeNull();
  });

  it("divides the item's cost lines by its quantity", () => {
    const values = itemProfitValues({
      orderItemId: ITEM,
      quantity: 2,
      bestKnownLines: [
        costLine({
          type: ProfitLineType.COST_COGS,
          orderItemId: ITEM,
          gross: '200.00',
          vatRatePct: '10',
        }),
        // A cost line of another item must not count toward this item.
        costLine({
          type: ProfitLineType.COST_COGS,
          orderItemId: OTHER_ITEM,
          gross: '999.00',
          vatRatePct: '20',
        }),
      ],
      estimateLines: [],
      issues: [],
    });

    expect(values.unitCostGross).toBe('100.00');
    expect(values.unitCostVatRate).toBe('10');
  });

  it('sums several cost profiles', () => {
    const shared = itemProfitValues({
      orderItemId: ITEM,
      quantity: 1,
      bestKnownLines: [
        costLine({
          type: ProfitLineType.COST_COGS,
          orderItemId: ITEM,
          gross: '120.00',
          vatRatePct: '20',
        }),
        costLine({
          type: ProfitLineType.COST_PACKAGING,
          orderItemId: ITEM,
          gross: '30.00',
          vatRatePct: '20',
        }),
        costLine({
          type: ProfitLineType.COST_SHIPPING,
          orderItemId: ITEM,
          gross: '10.00',
          vatRatePct: '20',
        }),
      ],
      estimateLines: [],
      issues: [],
    });
    expect(shared.unitCostGross).toBe('160.00');
    expect(shared.unitCostVatRate).toBe('20');

    const mixed = itemProfitValues({
      orderItemId: ITEM,
      quantity: 1,
      bestKnownLines: [
        costLine({
          type: ProfitLineType.COST_COGS,
          orderItemId: ITEM,
          gross: '120.00',
          vatRatePct: '20',
        }),
        costLine({
          type: ProfitLineType.COST_OTHER,
          orderItemId: ITEM,
          gross: '5.00',
          vatRatePct: '8',
        }),
      ],
      estimateLines: [],
      issues: [],
    });
    expect(mixed.unitCostGross).toBe('125.00');
    // Rates differ, so there is no single rate to report.
    expect(mixed.unitCostVatRate).toBeNull();
  });

  it('reports zero cost when the item has no cost line and no issue', () => {
    const values = itemProfitValues({
      orderItemId: ITEM,
      quantity: 1,
      bestKnownLines: [
        commissionLine({
          orderItemId: ITEM,
          gross: '20.00',
          certainty: ProfitLineCertainty.ESTIMATE,
          source: ProfitLineSource.RULE,
        }),
      ],
      estimateLines: [],
      issues: [],
    });

    expect(values.unitCostGross).toBe('0.00');
    expect(values.unitCostVatRate).toBeNull();
  });

  it('reports a null cost when a MISSING_COST issue names the item', () => {
    const issues: ProfitIssue[] = [
      { code: ProfitIssueCode.MISSING_COST, orderItemId: ITEM, detail: null },
    ];
    const named = itemProfitValues({
      orderItemId: ITEM,
      quantity: 1,
      bestKnownLines: [],
      estimateLines: [],
      issues,
    });
    expect(named.unitCostGross).toBeNull();

    // The same issue naming another item leaves this item at a plain zero cost.
    const other = itemProfitValues({
      orderItemId: OTHER_ITEM,
      quantity: 1,
      bestKnownLines: [],
      estimateLines: [],
      issues,
    });
    expect(other.unitCostGross).toBe('0.00');
  });

  it('treats a parcel-wide missing cost as missing for every item', () => {
    const issues: ProfitIssue[] = [
      { code: ProfitIssueCode.MISSING_COST, orderItemId: null, detail: null },
    ];
    for (const orderItemId of [ITEM, OTHER_ITEM]) {
      const values = itemProfitValues({
        orderItemId,
        quantity: 1,
        bestKnownLines: [],
        estimateLines: [],
        issues,
      });
      expect(values.unitCostGross).toBeNull();
    }
  });

  it('reports a null unit cost for a non-positive quantity', () => {
    const bestKnownLines = [
      costLine({
        type: ProfitLineType.COST_COGS,
        orderItemId: ITEM,
        gross: '120.00',
        vatRatePct: '20',
      }),
    ];
    for (const quantity of [0, -3]) {
      const values = itemProfitValues({
        orderItemId: ITEM,
        quantity,
        bestKnownLines,
        estimateLines: [],
        issues: [],
      });
      expect(values.unitCostGross).toBeNull();
    }
  });

  it('takes the commission amount from the best-known line and the rate from the estimate', () => {
    const values = itemProfitValues({
      orderItemId: ITEM,
      quantity: 1,
      bestKnownLines: [
        commissionLine({
          orderItemId: ITEM,
          gross: '30.00',
          certainty: ProfitLineCertainty.ACTUAL,
          source: ProfitLineSource.MARKETPLACE_RECORD,
        }),
      ],
      estimateLines: [
        commissionLine({
          orderItemId: ITEM,
          gross: '28.00',
          certainty: ProfitLineCertainty.ESTIMATE,
          source: ProfitLineSource.RULE,
          ratePct: '19',
        }),
      ],
      issues: [],
    });

    expect(values.commissionGross).toBe('30.00');
    expect(values.commissionRate).toBe('19');
    expect(values.estimatedCommissionGross).toBe('28.00');
    expect(values.settledCommissionGross).toBe('30.00');
  });

  it('takes the commission VAT rate from the same estimate line as the rate', () => {
    const values = itemProfitValues({
      orderItemId: ITEM,
      quantity: 1,
      bestKnownLines: [],
      estimateLines: [
        // No rate input: skipped, so its VAT rate must not be reported.
        commissionLine({
          orderItemId: ITEM,
          gross: '5.00',
          certainty: ProfitLineCertainty.ESTIMATE,
          source: ProfitLineSource.RULE,
          vatRatePct: '18',
        }),
        commissionLine({
          orderItemId: ITEM,
          gross: '28.00',
          certainty: ProfitLineCertainty.ESTIMATE,
          source: ProfitLineSource.RULE,
          ratePct: '19',
          vatRatePct: '20',
        }),
        // Another item's line must not count toward this item.
        commissionLine({
          orderItemId: OTHER_ITEM,
          gross: '9.00',
          certainty: ProfitLineCertainty.ESTIMATE,
          source: ProfitLineSource.RULE,
          ratePct: '7',
          vatRatePct: '10',
        }),
      ],
      issues: [],
    });

    expect(values.commissionRate).toBe('19');
    expect(values.commissionVatRate).toBe('20');
  });

  it('reports a null commission VAT rate when the rate line has none or no line has a rate', () => {
    const noVat = itemProfitValues({
      orderItemId: ITEM,
      quantity: 1,
      bestKnownLines: [],
      estimateLines: [
        commissionLine({
          orderItemId: ITEM,
          gross: '28.00',
          certainty: ProfitLineCertainty.ESTIMATE,
          source: ProfitLineSource.RULE,
          ratePct: '19',
        }),
      ],
      issues: [],
    });
    expect(noVat.commissionRate).toBe('19');
    expect(noVat.commissionVatRate).toBeNull();

    const noRateLine = itemProfitValues({
      orderItemId: ITEM,
      quantity: 1,
      bestKnownLines: [],
      estimateLines: [
        commissionLine({
          orderItemId: ITEM,
          gross: '28.00',
          certainty: ProfitLineCertainty.ESTIMATE,
          source: ProfitLineSource.RULE,
          vatRatePct: '20',
        }),
      ],
      issues: [],
    });
    expect(noRateLine.commissionRate).toBeNull();
    expect(noRateLine.commissionVatRate).toBeNull();
  });

  it('reports a settled commission only for a marketplace record', () => {
    const estimateOnly = itemProfitValues({
      orderItemId: ITEM,
      quantity: 1,
      bestKnownLines: [
        commissionLine({
          orderItemId: ITEM,
          gross: '28.00',
          certainty: ProfitLineCertainty.ESTIMATE,
          source: ProfitLineSource.RULE,
        }),
      ],
      estimateLines: [
        commissionLine({
          orderItemId: ITEM,
          gross: '28.00',
          certainty: ProfitLineCertainty.ESTIMATE,
          source: ProfitLineSource.RULE,
          ratePct: '19',
        }),
      ],
      issues: [],
    });
    expect(estimateOnly.commissionGross).toBe('28.00');
    expect(estimateOnly.estimatedCommissionGross).toBe('28.00');
    expect(estimateOnly.settledCommissionGross).toBeNull();

    // A user override is an actual, but it is not a marketplace record either.
    const override = itemProfitValues({
      orderItemId: ITEM,
      quantity: 1,
      bestKnownLines: [
        commissionLine({
          orderItemId: ITEM,
          gross: '26.00',
          certainty: ProfitLineCertainty.USER_OVERRIDE,
          source: ProfitLineSource.USER,
        }),
      ],
      estimateLines: [],
      issues: [],
    });
    expect(override.settledCommissionGross).toBeNull();
    expect(override.commissionGross).toBe('26.00');
  });
});
