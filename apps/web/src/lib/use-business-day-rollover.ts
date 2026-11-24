'use client';

import { getBusinessDayRangeOfDate } from '@pazarsync/utils';
import * as React from 'react';

/** Fire a little after the boundary. */
export const ROLLOVER_GRACE_MS = 2_000;
/** Re-fire until the server's business date advances. */
export const ROLLOVER_RETRY_MS = 10_000;
export const ROLLOVER_MAX_RETRIES = 12;

/**
 * Calls onRollover when the business day named by `openBusinessDate` (the SERVER's open date, YYYY-MM-DD)
 * ends, then again every ROLLOVER_RETRY_MS until `openBusinessDate` changes or the retry budget is spent.
 * Inert while `openBusinessDate` is undefined.
 *
 * The client clock only schedules the call; the server decides what is visible. When the client clock
 * runs ahead, the first refetch still returns the old date, so the retries keep asking until the server's
 * date moves; the new date re-runs the effect, which schedules the next boundary. A background tab
 * throttles its timers, so becoming visible again re-arms from the current time with a fresh retry budget.
 * `Date.now()` is read only inside the effect, never during render.
 */
export function useBusinessDayRollover(
  openBusinessDate: string | undefined,
  onRollover: () => void,
): void {
  // Latest callback through a ref, so a new callback identity never re-arms the timers.
  const onRolloverRef = React.useRef(onRollover);
  React.useEffect(() => {
    onRolloverRef.current = onRollover;
  }, [onRollover]);

  React.useEffect(() => {
    if (openBusinessDate === undefined) return;

    const dayEndMs = getBusinessDayRangeOfDate(openBusinessDate).end.getTime();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let retriesLeft = ROLLOVER_MAX_RETRIES;

    const clearTimer = (): void => {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
    };

    const fire = (): void => {
      timer = null;
      onRolloverRef.current();
      if (retriesLeft === 0) return;
      retriesLeft -= 1;
      timer = setTimeout(fire, ROLLOVER_RETRY_MS);
    };

    const arm = (): void => {
      clearTimer();
      retriesLeft = ROLLOVER_MAX_RETRIES;
      const delay = Math.max(0, dayEndMs - Date.now() + ROLLOVER_GRACE_MS);
      timer = setTimeout(fire, delay);
    };

    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') arm();
    };

    arm();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearTimer();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [openBusinessDate]);
}
