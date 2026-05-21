// End-of-cycle reconciliation status bump.
//
// Design comment line 134-135 (schema.prisma):
//   PARTIALLY_SETTLED: Bazı SETTLEMENT/CARGO_INVOICE OrderFee'ler var,
//   Sale.paymentOrderId henüz null.
//   FULLY_SETTLED: Sale paymentOrderId dolu, settledNetProfit yazıldı.
//
// FULLY_SETTLED rows are NOT downgraded — handlePaymentOrderEntry already
// owns that transition. This helper only escalates NOT_SETTLED rows to
// PARTIALLY_SETTLED when at least one settlement-sourced OrderFee landed.
//
// Sale/Discount alone (item-level commission updates) do not flip the
// status — they don't produce OrderFee rows. The design treats item-level
// reconciliation as separate from order-level reconciliation; status
// reflects the fee-level state.

import type { Prisma } from '@pazarsync/db';

export interface BumpReconciliationStatusResult {
  /** Number of orders flipped to PARTIALLY_SETTLED. */
  bumpedCount: number;
}

export async function bumpReconciliationStatusForStore(
  storeId: string,
  tx: Prisma.TransactionClient,
): Promise<BumpReconciliationStatusResult> {
  // Settlement signals (either is sufficient — both indicate the order
  // has been touched by a settlement-side handler):
  //   - paymentOrderId backfilled (handleSale's settlement Sale row)
  //   - SETTLEMENT / CARGO_INVOICE OrderFee landed (handleReturn etc.)
  const result = await tx.order.updateMany({
    where: {
      storeId,
      reconciliationStatus: 'NOT_SETTLED',
      OR: [
        { paymentOrderId: { not: null } },
        {
          fees: {
            some: {
              source: { in: ['SETTLEMENT', 'CARGO_INVOICE'] },
            },
          },
        },
      ],
    },
    data: { reconciliationStatus: 'PARTIALLY_SETTLED' },
  });
  return { bumpedCount: result.count };
}
