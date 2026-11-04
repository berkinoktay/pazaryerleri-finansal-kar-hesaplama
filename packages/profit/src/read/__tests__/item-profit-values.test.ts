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

/** A commission line with a certainty/source and an optional estimate rate input. */
function commissionLine(params: {
  readonly orderItemId: string;
  readonly gross: string;
  readonly certainty: ProfitLineCertainty;
  readonly source: ProfitLineSource;
  readonly ratePct?: string;
}): ProfitLine {
  return createProfitLine({
    type: ProfitLineType.COMMISSION,
    level: ProfitLineLevel.ITEM,
    orderItemId: params.orderItemId,
    certainty: params.certainty,
    source: params.source,
    amount: { gross: new Decimal(params.gross), vat: new Decimal('0') },
    vatRatePct: null,
    inputs: params.ratePct === undefined ? {} : { ratePct: params.ratePct },
    externalRecord: null,
  });
}

describe('itemProfitValues', () => {
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
