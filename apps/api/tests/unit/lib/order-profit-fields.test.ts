import {
  OrderStatus,
  ProfitStatementView,
  ProfitStatus,
  ReconciliationStatus,
} from '@pazarsync/db/enums';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  orderProfitFields,
  toStatementPair,
  type StatementListRow,
} from '@/lib/order-profit-fields';

/** A best-known statement row; tests override single fields to exercise the mapping. */
function makeStatement(overrides: Partial<StatementListRow> = {}): StatementListRow {
  return {
    view: ProfitStatementView.BEST_KNOWN,
    status: ProfitStatus.ESTIMATED,
    saleGross: new Decimal('240.00'),
    vatOutput: new Decimal('40.00'),
    netProfit: new Decimal('60.00'),
    saleMarginPct: new Decimal('25.00'),
    costMarkupPct: new Decimal('38.40'),
    reconciliationStatus: ReconciliationStatus.NOT_SETTLED,
    ...overrides,
  };
}

describe('orderProfitFields', () => {
  it('maps the best-known reconciliation status and defaults to NOT_SETTLED', () => {
    const withStatement = orderProfitFields({
      pair: toStatementPair([
        makeStatement({ view: ProfitStatementView.ESTIMATE }),
        makeStatement({
          view: ProfitStatementView.BEST_KNOWN,
          reconciliationStatus: ReconciliationStatus.PARTIALLY_SETTLED,
        }),
      ]),
      orderStatus: OrderStatus.DELIVERED,
      orderSaleGross: new Decimal('240.00'),
      orderSaleVat: null,
    });
    expect(withStatement.reconciliationStatus).toBe(ReconciliationStatus.PARTIALLY_SETTLED);

    const noStatement = orderProfitFields({
      pair: toStatementPair([]),
      orderStatus: OrderStatus.DELIVERED,
      orderSaleGross: new Decimal('240.00'),
      orderSaleVat: null,
    });
    expect(noStatement.reconciliationStatus).toBe(ReconciliationStatus.NOT_SETTLED);
  });

  it('shows the settled profit only once reconciliation started', () => {
    const notSettled = orderProfitFields({
      pair: toStatementPair([
        makeStatement({ view: ProfitStatementView.ESTIMATE, netProfit: new Decimal('60.00') }),
        makeStatement({
          view: ProfitStatementView.BEST_KNOWN,
          netProfit: new Decimal('55.00'),
          reconciliationStatus: ReconciliationStatus.NOT_SETTLED,
        }),
      ]),
      orderStatus: OrderStatus.DELIVERED,
      orderSaleGross: new Decimal('240.00'),
      orderSaleVat: null,
    });
    expect(notSettled.estimatedNetProfit).toBe('60');
    expect(notSettled.settledNetProfit).toBeNull();

    const settled = orderProfitFields({
      pair: toStatementPair([
        makeStatement({ view: ProfitStatementView.ESTIMATE, netProfit: new Decimal('60.00') }),
        makeStatement({
          view: ProfitStatementView.BEST_KNOWN,
          netProfit: new Decimal('55.00'),
          reconciliationStatus: ReconciliationStatus.PARTIALLY_SETTLED,
        }),
      ]),
      orderStatus: OrderStatus.DELIVERED,
      orderSaleGross: new Decimal('240.00'),
      orderSaleVat: null,
    });
    expect(settled.estimatedNetProfit).toBe('60');
    expect(settled.settledNetProfit).toBe('55');
  });

  it('falls back to the order sale and to zero for a cancelled order without a statement', () => {
    const delivered = orderProfitFields({
      pair: toStatementPair([]),
      orderStatus: OrderStatus.DELIVERED,
      orderSaleGross: new Decimal('150.00'),
      orderSaleVat: null,
    });
    expect(delivered.saleGross).toBe('150');

    const cancelled = orderProfitFields({
      pair: toStatementPair([]),
      orderStatus: OrderStatus.CANCELLED,
      orderSaleGross: new Decimal('240.00'),
      orderSaleVat: null,
    });
    expect(cancelled.saleGross).toBe('0');

    const unsynced = orderProfitFields({
      pair: toStatementPair([]),
      orderStatus: OrderStatus.DELIVERED,
      orderSaleGross: null,
      orderSaleVat: null,
    });
    expect(unsynced.saleGross).toBeNull();

    // A best-known statement always wins over the order's own sale.
    const withStatement = orderProfitFields({
      pair: toStatementPair([makeStatement({ saleGross: new Decimal('180.00') })]),
      orderStatus: OrderStatus.CANCELLED,
      orderSaleGross: new Decimal('240.00'),
      orderSaleVat: null,
    });
    expect(withStatement.saleGross).toBe('180');
  });

  it('reads the sale VAT from the same source as the sale', () => {
    const withStatement = orderProfitFields({
      pair: toStatementPair([makeStatement({ vatOutput: new Decimal('12.73') })]),
      orderStatus: OrderStatus.DELIVERED,
      orderSaleGross: new Decimal('240.00'),
      orderSaleVat: new Decimal('36.06'),
    });
    expect(withStatement.saleVat).toBe('12.73');

    const cancelled = orderProfitFields({
      pair: toStatementPair([]),
      orderStatus: OrderStatus.CANCELLED,
      orderSaleGross: new Decimal('240.00'),
      orderSaleVat: new Decimal('36.06'),
    });
    expect(cancelled.saleVat).toBe('0');

    const open = orderProfitFields({
      pair: toStatementPair([]),
      orderStatus: OrderStatus.PROCESSING,
      orderSaleGross: new Decimal('240.00'),
      orderSaleVat: new Decimal('36.06'),
    });
    expect(open.saleVat).toBe('36.06');
  });

  it('hides a penalty-free cancelled net profit and keeps a penalty', () => {
    // A cancellation writes no SALE line: zero sale, null margins. The estimate view is
    // never reconciled; the best-known view settles fully once the records arrive.
    const cancelledView = {
      status: ProfitStatus.CANCELLED,
      saleGross: new Decimal('0'),
      saleMarginPct: null,
      costMarkupPct: null,
    };
    const cancelledEstimate = {
      ...cancelledView,
      view: ProfitStatementView.ESTIMATE,
      reconciliationStatus: ReconciliationStatus.NOT_SETTLED,
      netProfit: new Decimal('0'),
    };
    const noPenalty = orderProfitFields({
      pair: toStatementPair([
        makeStatement(cancelledEstimate),
        makeStatement({
          ...cancelledView,
          reconciliationStatus: ReconciliationStatus.FULLY_SETTLED,
          netProfit: new Decimal('0'),
        }),
      ]),
      orderStatus: OrderStatus.CANCELLED,
      orderSaleGross: new Decimal('240.00'),
      orderSaleVat: null,
    });
    expect(noPenalty.estimatedNetProfit).toBeNull();
    expect(noPenalty.settledNetProfit).toBeNull();

    // The engine writes no estimate line for a cancellation: the estimate view stays a
    // zero-net cancel, and the penalty arrives with the settlement on the best-known view.
    const withPenalty = orderProfitFields({
      pair: toStatementPair([
        makeStatement(cancelledEstimate),
        makeStatement({
          ...cancelledView,
          reconciliationStatus: ReconciliationStatus.FULLY_SETTLED,
          netProfit: new Decimal('-15.00'),
        }),
      ]),
      orderStatus: OrderStatus.CANCELLED,
      orderSaleGross: new Decimal('240.00'),
      orderSaleVat: null,
    });
    expect(withPenalty.estimatedNetProfit).toBeNull();
    expect(withPenalty.settledNetProfit).toBe('-15');
  });
});
