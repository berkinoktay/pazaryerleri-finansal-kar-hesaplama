import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFinalizingPoll } from '@/features/orders/hooks/use-finalizing-poll';
import { FINALIZING_POLL_MAX_MS, FINALIZING_POLL_MS } from '@/features/orders/lib/finalizing-poll';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.now());
});

afterEach(() => {
  vi.useRealTimers();
});

const STORE_A = 'store-a';
const STORE_B = 'store-b';

describe('useFinalizingPoll', () => {
  it('the summary decision follows the last list value and the same cap', () => {
    const { result } = renderHook(() => useFinalizingPoll(STORE_A));
    const startedAt = Date.now();

    // Nothing recorded yet: the summary does not poll.
    expect(result.current.forSummary()).toBe(false);

    expect(result.current.fromList(true)).toBe(FINALIZING_POLL_MS);
    expect(result.current.forSummary()).toBe(FINALIZING_POLL_MS);

    // Past the cap both stop, although the list still says finalizing.
    vi.setSystemTime(startedAt + FINALIZING_POLL_MAX_MS + 1);
    expect(result.current.fromList(true)).toBe(false);
    expect(result.current.forSummary()).toBe(false);

    // A false in between closes the window; the next true opens a new one.
    expect(result.current.fromList(false)).toBe(false);
    expect(result.current.fromList(true)).toBe(FINALIZING_POLL_MS);
    expect(result.current.forSummary()).toBe(FINALIZING_POLL_MS);
  });

  it('fromList(false) and fromList(undefined) stop the summary too', () => {
    const { result } = renderHook(() => useFinalizingPoll(STORE_A));

    result.current.fromList(true);
    expect(result.current.forSummary()).toBe(FINALIZING_POLL_MS); // control
    expect(result.current.fromList(false)).toBe(false);
    expect(result.current.forSummary()).toBe(false);

    result.current.fromList(true);
    expect(result.current.forSummary()).toBe(FINALIZING_POLL_MS); // control
    expect(result.current.fromList(undefined)).toBe(false);
    expect(result.current.forSummary()).toBe(false);
  });

  it('keeps the same function identities across rerenders', () => {
    const { result, rerender } = renderHook(() => useFinalizingPoll(STORE_A));
    const first = result.current;

    rerender();

    expect(result.current.fromList).toBe(first.fromList);
    expect(result.current.forSummary).toBe(first.forSummary);
  });

  it('a store change starts a fresh window', () => {
    const { result, rerender } = renderHook(({ scope }) => useFinalizingPoll(scope), {
      initialProps: { scope: STORE_A },
    });
    const storeAStartedAt = Date.now();
    result.current.fromList(true);
    expect(result.current.forSummary()).toBe(FINALIZING_POLL_MS); // control

    // Another store: nothing is recorded for it yet, so its summary does not poll.
    rerender({ scope: STORE_B });
    expect(result.current.forSummary()).toBe(false);

    // Its window opens when its own list first says finalizing, so it outlives
    // the window store A opened earlier.
    vi.setSystemTime(storeAStartedAt + FINALIZING_POLL_MAX_MS - 1_000);
    expect(result.current.fromList(true)).toBe(FINALIZING_POLL_MS);
    vi.setSystemTime(storeAStartedAt + FINALIZING_POLL_MAX_MS + 1_000);
    expect(result.current.fromList(true)).toBe(FINALIZING_POLL_MS);
    expect(result.current.forSummary()).toBe(FINALIZING_POLL_MS);
  });
});
