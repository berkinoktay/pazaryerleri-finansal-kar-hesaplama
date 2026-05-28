/**
 * Promote retry policy — exponential-ish backoff in minutes.
 * Index = attempts count so far (after the most recent failure).
 *   attempts=1 (first failure)  → wait 5 min before next try
 *   attempts=2 (second failure) → wait 15 min before next try
 *   attempts=3 (third failure)  → wait 45 min before next try
 *   attempts=4 → PERMANENT_FAILED, no further retries
 */
export const RETRY_BACKOFF_MINUTES = [5, 15, 45] as const;

export const MAX_ATTEMPTS = RETRY_BACKOFF_MINUTES.length;

export interface IsRetryDueArgs {
  attempts: number;
  lastFailedAt: Date;
  now: Date;
}

/**
 * True when a FAILED entry's backoff window for its current attempt count has
 * elapsed. attempts outside [1, MAX_ATTEMPTS] are never due: 0 = never failed,
 * > MAX = already PERMANENT_FAILED.
 */
export function isRetryDue({ attempts, lastFailedAt, now }: IsRetryDueArgs): boolean {
  if (attempts < 1 || attempts > MAX_ATTEMPTS) {
    return false;
  }
  const requiredWaitMinutes = RETRY_BACKOFF_MINUTES[attempts - 1];
  if (requiredWaitMinutes === undefined) {
    return false;
  }
  const elapsedMs = now.getTime() - lastFailedAt.getTime();
  return elapsedMs >= requiredWaitMinutes * 60_000;
}
