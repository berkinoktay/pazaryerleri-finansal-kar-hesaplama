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
 * `scope` is the store the page shows. The page stays mounted across a store
 * switch, so a new scope gets a fresh poll: another store's flag must not drive
 * this store's summary, and its window must not shorten this store's cap.
 * Stable identity across renders while the scope is unchanged.
 */
export function useFinalizingPoll(scope: string | null): FinalizingPoll {
  const [current, setCurrent] = React.useState(() => ({
    scope,
    poll: createFinalizingPoll(),
  }));
  // React's "store information from previous renders" pattern: a guarded
  // setState during render swaps the poll before any effect or timer reads it.
  if (current.scope !== scope) {
    const next = { scope, poll: createFinalizingPoll() };
    setCurrent(next);
    return next.poll;
  }
  return current.poll;
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
