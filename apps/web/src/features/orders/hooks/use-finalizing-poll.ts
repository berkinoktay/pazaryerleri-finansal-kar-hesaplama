'use client';

import * as React from 'react';

import { finalizingPollInterval } from '../lib/finalizing-poll';

/** ONE poll decision shared by the orders list and its KPI summary. */
export interface FinalizingPoll {
  /** For the list query: records what the latest list response says and returns the interval. */
  readonly fromList: (finalizing: boolean | undefined) => number | false;
  /** For the summary query: the same decision, from the last value the list recorded. */
  readonly forSummary: () => number | false;
}

/**
 * The orders page's poll while a completed day is finalizing. The list hands
 * `fromList` its latest `openDay.finalizing` through React Query's
 * `refetchInterval` callback; the summary reads the SAME recorded value and
 * window start through `forSummary`, so both stop at the same cap. A summary
 * interval derived from the cached flag alone would keep polling after the list
 * gave up, for as long as the tab stays open.
 *
 * React Query also evaluates `refetchInterval` while constructing an observer,
 * which happens during the first render. The clock is therefore read only while
 * the list says finalizing, and nothing these functions return reaches markup.
 *
 * Stable identity across renders: the object is created once per mount.
 */
export function useFinalizingPoll(): FinalizingPoll {
  const [poll] = React.useState(createFinalizingPoll);
  return poll;
}

function createFinalizingPoll(): FinalizingPoll {
  // The last `finalizing` the list reported, and when it was first seen true
  // (null while it is not finalizing). Written only by `fromList`.
  let lastFinalizing: boolean | undefined;
  let startedAt: number | null = null;

  const decide = (): number | false =>
    lastFinalizing === true
      ? finalizingPollInterval({ finalizing: true, startedAt, now: Date.now() })
      : false;

  return {
    fromList: (finalizing) => {
      lastFinalizing = finalizing;
      if (finalizing !== true) {
        startedAt = null;
      } else if (startedAt === null) {
        startedAt = Date.now();
      }
      return decide();
    },
    forSummary: decide,
  };
}
