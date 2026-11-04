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
    });
    expect(withStatement.reconciliationStatus).toBe(ReconciliationStatus.PARTIALLY_SETTLED);

    const noStatement = orderProfitFields({
      pair: toStatementPair([]),
      orderStatus: OrderStatus.DELIVERED,
      orderSaleGross: new Decimal('240.00'),
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
    });
    expect(settled.estimatedNetProfit).toBe('60');
    expect(settled.settledNetProfit).toBe('55');
  });

  it('falls back to the order sale and to zero for a cancelled order without a statement', () => {
    const delivered = orderProfitFields({
      pair: toStatementPair([]),
      orderStatus: OrderStatus.DELIVERED,
      orderSaleGross: new Decimal('150.00'),
    });
    expect(delivered.saleGross).toBe('150');

    const cancelled = orderProfitFields({
      pair: toStatementPair([]),
      orderStatus: OrderStatus.CANCELLED,
      orderSaleGross: new Decimal('240.00'),
    });
    expect(cancelled.saleGross).toBe('0');

    const unsynced = orderProfitFields({
      pair: toStatementPair([]),
      orderStatus: OrderStatus.DELIVERED,
      orderSaleGross: null,
    });
    expect(unsynced.saleGross).toBeNull();

    // A best-known statement always wins over the order's own sale.
    const withStatement = orderProfitFields({
      pair: toStatementPair([makeStatement({ saleGross: new Decimal('180.00') })]),
      orderStatus: OrderStatus.CANCELLED,
      orderSaleGross: new Decimal('240.00'),
    });
    expect(withStatement.saleGross).toBe('180');
  });
});
