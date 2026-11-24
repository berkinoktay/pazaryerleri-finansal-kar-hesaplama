/**
 * The permanent exclusion reason of a past-day order that missed its cost or desi
 * (cost-window rule, Berkin 2026-11-03; desi rule, Berkin 2026-11-22). Shared by order
 * intake and the day-close finaliser (same-day edit window, plan PR-1), so a stored
 * order and its buffered twin end the day with the same reason.
 *
 *                       graduated                no buffer row (direct)
 *   cost missed day     COST_DEADLINE_MISSED     LATE_UNCOSTED_ARRIVAL
 *   cost ok, no desi    DESI_DEADLINE_MISSED     LATE_DESILESS_ARRIVAL
 */

import { ProfitExclusionReason } from '@pazarsync/db/enums';

/** Which requirement a past-day order missed; the cost wins when both are missing. */
export type PastDayGap = 'cost' | 'desi';

/**
 * Permanent exclusion reason per past-day gap: `graduated` when the order arrived
 * within its business day and merely missed the deadline (a coexisting buffer row is
 * removed in the persisting transaction), `direct` when it was first seen after its
 * day had closed.
 */
export const PAST_DAY_GAP_REASONS = {
  cost: {
    graduated: ProfitExclusionReason.COST_DEADLINE_MISSED,
    direct: ProfitExclusionReason.LATE_UNCOSTED_ARRIVAL,
  },
  desi: {
    graduated: ProfitExclusionReason.DESI_DEADLINE_MISSED,
    direct: ProfitExclusionReason.LATE_DESILESS_ARRIVAL,
  },
} as const satisfies Record<
  PastDayGap,
  { graduated: ProfitExclusionReason; direct: ProfitExclusionReason }
>;

/** The permanent exclusion reason of a past-day gap for the way the order arrived. */
export function pastDayGapReason(
  gap: PastDayGap,
  arrival: 'graduated' | 'direct',
): ProfitExclusionReason {
  return PAST_DAY_GAP_REASONS[gap][arrival];
}
