// While the orders list response says `openDay.finalizing`, a completed business
// day is still being closed and its profit figures can still change. The page
// refetches on this interval until the flag turns false, and gives up after the
// cap so a day-close stuck in backoff (or a stopped worker) does not keep a tab
// polling forever; the finalizing note stays until the next natural refetch.

/** Poll interval while the list response says `finalizing`. */
export const FINALIZING_POLL_MS = 15_000;

/** Stop polling this long after `finalizing` was first seen true; the note stays. */
export const FINALIZING_POLL_MAX_MS = 900_000;

/**
 * The React Query `refetchInterval` for the orders list and its summary while a
 * completed day is finalizing. `startedAt` is the ms epoch when `finalizing` was
 * first seen true (null when it is not finalizing); `now` is the current ms epoch.
 */
export function finalizingPollInterval(args: {
  finalizing: boolean | undefined;
  startedAt: number | null;
  now: number;
}): number | false {
  // Without a recorded start there is no window to cap, so never poll unbounded.
  if (args.finalizing !== true || args.startedAt === null) {
    return false;
  }
  if (args.now - args.startedAt >= FINALIZING_POLL_MAX_MS) {
    return false;
  }
  return FINALIZING_POLL_MS;
}
