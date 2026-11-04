import { prisma } from '@pazarsync/db';
import {
  UnsupportedPlatformError,
  computeParcelProfit,
  type ComputedParcelProfit,
} from '@pazarsync/profit';

/**
 * The read surfaces that compute a parcel's profit in-request when no statement is
 * stored. The order detail page and the new-order notification share the same
 * deliberate fallback, so each names itself here for the log line.
 */
export type ProfitReadSurface = 'order-detail' | 'order-notification';

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
    console.error('[profit-read] in-request profit computation failed', {
      surface,
      organizationId,
      orderId,
      err,
    });
    return null;
  }
}
