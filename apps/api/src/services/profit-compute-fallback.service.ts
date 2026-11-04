import { prisma } from '@pazarsync/db';
import {
  UnsupportedPlatformError,
  computeParcelProfit,
  type ComputedParcelProfit,
} from '@pazarsync/profit';

/**
 * A read surface that must keep its page up when a parcel's profit cannot be derived for
 * display. The order detail and the new-order notification compute in-request when no
 * statement is stored; today's products reads the stored profit lines; product pricing
 * evaluates a scenario per variant. Each names itself here for the log line (owner
 * decision 2026-11-04).
 */
export type ProfitReadSurface =
  | 'order-detail'
  | 'order-notification'
  | 'today-products'
  | 'product-pricing';

/**
 * Logs a profit-read failure at error level, tagged `[profit-read]` with the surface and
 * the order id (null when the failure is not tied to a single order, e.g. today's
 * products list) so support can trace the line. The single sink for the owner's "the
 * page opens, the profit stays empty, the error is logged" rule (decision 2026-11-04):
 * every read surface that swallows a profit failure to keep its page up routes here.
 *
 * `failedCount` is set only by a list that logs its per-row failures once (how many rows
 * of the request failed; `err` is then the first failure), so a systemic failure on a
 * large list is one log line, not one per row. It is omitted from the logged object when
 * absent, so single-order surfaces log exactly as before.
 */
export function logProfitReadFailure(params: {
  readonly surface: ProfitReadSurface;
  readonly organizationId: string;
  readonly orderId: string | null;
  readonly err: unknown;
  readonly failedCount?: number;
}): void {
  console.error('[profit-read] in-request profit computation failed', {
    surface: params.surface,
    organizationId: params.organizationId,
    orderId: params.orderId,
    ...(params.failedCount !== undefined ? { failedCount: params.failedCount } : {}),
    err: params.err,
  });
}

/**
 * Computes a parcel's profit read-only for a surface that must still render when no
 * best-known statement is stored. This is a deliberate, logged fallback -- not a silent
 * swallow (owner decision 2026-11-04). A stored BEST_KNOWN statement is the normal
 * source, but it can be legitimately absent: for seconds after a new order while the
 * writer catches up, for hours during the first deploy's recompute backlog, and
 * permanently for an order whose recompute keeps failing. In every one of those the page
 * (and the notification) must open with an empty profit section rather than a 500.
 *
 * Returns the computed profit on success. Returns null without logging for a platform
 * the engine cannot compute (`UnsupportedPlatformError`) -- an expected, non-error case.
 * For every other failure it logs at error level, tagged with the surface and the order
 * id so support can trace the line, then returns null so the caller renders the empty
 * profit section. The error is never rethrown: the owner has chosen the open page over
 * the 500.
 */
export async function computeParcelProfitForRead(params: {
  readonly organizationId: string;
  readonly orderId: string;
  readonly surface: ProfitReadSurface;
}): Promise<ComputedParcelProfit | null> {
  const { organizationId, orderId, surface } = params;
  try {
    return await computeParcelProfit(prisma, { organizationId, orderId });
  } catch (err) {
    if (err instanceof UnsupportedPlatformError) {
      // A platform the engine cannot compute yet (e.g. Hepsiburada): expected, no log.
      return null;
    }
    logProfitReadFailure({ surface, organizationId, orderId, err });
    return null;
  }
}
