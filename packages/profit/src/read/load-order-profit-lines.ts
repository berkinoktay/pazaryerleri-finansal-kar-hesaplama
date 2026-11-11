import { type Prisma } from '@pazarsync/db';

import { type ProfitLine } from '../core/profit-line';
import { STORED_PROFIT_LINE_SELECT, toProfitLine } from './stored-profit-line';

/**
 * Loads the stored profit lines of several orders in one query and groups them by
 * order id, rebuilding each row into an engine `ProfitLine`. Filtered by organization
 * AND store AND the id list (tenant defense), ordered deterministically by (orderId,
 * id). Every input id appears in the returned map -- an order with no lines maps to an
 * empty array -- and an empty input list returns an empty map without querying.
 *
 * The order of each order's lines is not meaningful: the ids are random and rewritten
 * on every recompute, so consumers must aggregate by type and item and never rely on
 * sequence.
 */
export async function loadOrderProfitLines(
  tx: Prisma.TransactionClient,
  params: {
    readonly organizationId: string;
    readonly storeId: string;
    readonly orderIds: readonly string[];
  },
): Promise<ReadonlyMap<string, readonly ProfitLine[]>> {
  const { organizationId, storeId, orderIds } = params;

  const byOrderId = new Map<string, ProfitLine[]>();
  if (orderIds.length === 0) {
    return byOrderId;
  }
  for (const orderId of orderIds) {
    byOrderId.set(orderId, []);
  }

  const rows = await tx.profitLine.findMany({
    where: { organizationId, storeId, orderId: { in: [...orderIds] } },
    select: STORED_PROFIT_LINE_SELECT,
    orderBy: [{ orderId: 'asc' }, { id: 'asc' }],
  });

  for (const row of rows) {
    // The query only returns ids we asked for, so the bucket always exists.
    byOrderId.get(row.orderId)?.push(toProfitLine(row));
  }
  return byOrderId;
}
