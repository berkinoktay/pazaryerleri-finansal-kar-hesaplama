/**
 * Order profit computation service.
 *
 * **PR-5c (2026-05-19) — STUB.** Original implementation used eski Order ücret
 * kolonları (totalAmount, commissionAmount, shippingCost, platformFee, netProfit)
 * that were dropped in this PR. New implementation lives in PR-6:
 *
 *   - `applyEstimateOnOrderCreate` (T+0 write-once tahmini kar)
 *   - `recomputeSettledProfit` (mutable, settlement-driven)
 *
 * Bu dosya PR-6'da `apps/api/src/services/profit/` altında baştan yazılır.
 * `recomputeOrderProfit` export'u eski signature ile no-op olarak duruyor ki
 * `apps/sync-worker/src/handlers/orders.ts` import path'i typecheck'ten geçsin —
 * sync handler'ın gerçek Trendyol fetch logic'i de zaten dormant (PR-6'ya
 * bağımlı, V1 plan'ın DIŞINDA Trendyol Order Sync feature'ında inşa edilir).
 *
 * Tek source-of-truth profit formula: design §2.1-§2.2 (KDV-aware), PR-6'da
 * `computeProfit(ProfitInputs)` olarak yazılacak.
 */

import type { Prisma } from '@pazarsync/db';

/**
 * STUB — no-op until PR-6.
 *
 * Eski davranış (silindi): tüm OrderItem'lar snapshot'lı ise Order.netProfit'i
 * write-once yazardı. Yeni davranış PR-6'da: applyEstimateOnOrderCreate.
 *
 * Parametreler caller compatibility için signature'da tutuldu (sync-worker +
 * cost-snapshot-capture.test.ts hala bu signature ile çağırıyor). PR-6
 * implementation eklenince void cast'lar kaldırılır.
 */
export async function recomputeOrderProfit(
  orderId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  void orderId;
  void tx;
  // PR-6'da yeniden implement edilecek (design §4.2).
}
