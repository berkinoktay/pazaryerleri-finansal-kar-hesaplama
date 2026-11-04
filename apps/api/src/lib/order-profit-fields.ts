import type { Prisma } from '@pazarsync/db';
import { OrderStatus, ProfitStatementView, ReconciliationStatus } from '@pazarsync/db/enums';

/**
 * The statement columns the orders list and summary read. Kept narrow so the
 * list query stays cheap: the engine's rolled-up sale / net profit / margins
 * plus the reconciliation status, per statement view.
 */
export const STATEMENT_LIST_SELECT = {
  view: true,
  status: true,
  saleGross: true,
  netProfit: true,
  saleMarginPct: true,
  costMarkupPct: true,
  reconciliationStatus: true,
} as const satisfies Prisma.OrderProfitStatementSelect;

export type StatementListRow = Prisma.OrderProfitStatementGetPayload<{
  select: typeof STATEMENT_LIST_SELECT;
}>;

/**
 * The two statement views an order can carry. Either may be absent: a freshly
 * written order has neither until the engine runs; a marketplace the engine
 * cannot compute never gets a best-known statement.
 */
export interface StatementPair {
  readonly estimate: StatementListRow | null;
  readonly bestKnown: StatementListRow | null;
}

/** Split an order's loaded statement rows into its estimate / best-known pair. */
export function toStatementPair(rows: readonly StatementListRow[]): StatementPair {
  let estimate: StatementListRow | null = null;
  let bestKnown: StatementListRow | null = null;
  for (const row of rows) {
    if (row.view === ProfitStatementView.ESTIMATE) {
      estimate = row;
    } else if (row.view === ProfitStatementView.BEST_KNOWN) {
      bestKnown = row;
    }
  }
  return { estimate, bestKnown };
}

/**
 * The profit-derived fields of one orders-list row, in the legacy wire shape
 * (decimal `toString()`, which the orders tests pin). Everything but the
 * estimated net profit comes from the best-known statement (Faz 4A decisions
 * 1-4): a single best-known view is the "consumed" truth, so margin, ROI and
 * reconciliation status all read it.
 */
export interface OrderProfitFields {
  readonly reconciliationStatus: ReconciliationStatus;
  readonly saleGross: string | null;
  readonly estimatedNetProfit: string | null;
  readonly settledNetProfit: string | null;
  readonly saleMarginPct: string | null;
  readonly costMarkupPct: string | null;
}

/**
 * Sale = the best-known statement's sale when one exists; otherwise the order's
 * own sale, which is 0 for a cancelled order with no statement (decision 4 /
 * rule B5) and null until the order's items (and sale) are synced.
 */
function resolveSaleGross(
  bestKnown: StatementListRow | null,
  orderStatus: OrderStatus,
  orderSaleGross: Prisma.Decimal | null,
): string | null {
  if (bestKnown !== null) return bestKnown.saleGross.toString();
  if (orderStatus === OrderStatus.CANCELLED) return '0';
  return orderSaleGross?.toString() ?? null;
}

export function orderProfitFields(input: {
  readonly pair: StatementPair;
  readonly orderStatus: OrderStatus;
  readonly orderSaleGross: Prisma.Decimal | null;
}): OrderProfitFields {
  const { estimate, bestKnown } = input.pair;

  // Settled profit only surfaces once reconciliation has started (decision 1);
  // before that it is null even though the best-known net profit already exists.
  const reconciliationStarted =
    bestKnown !== null && bestKnown.reconciliationStatus !== ReconciliationStatus.NOT_SETTLED;

  return {
    reconciliationStatus: bestKnown?.reconciliationStatus ?? ReconciliationStatus.NOT_SETTLED,
    saleGross: resolveSaleGross(bestKnown, input.orderStatus, input.orderSaleGross),
    estimatedNetProfit: estimate?.netProfit?.toString() ?? null,
    settledNetProfit: reconciliationStarted ? (bestKnown.netProfit?.toString() ?? null) : null,
    saleMarginPct: bestKnown?.saleMarginPct?.toString() ?? null,
    costMarkupPct: bestKnown?.costMarkupPct?.toString() ?? null,
  };
}
