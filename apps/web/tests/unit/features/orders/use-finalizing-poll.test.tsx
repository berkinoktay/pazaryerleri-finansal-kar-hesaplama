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

describe('useFinalizingPoll', () => {
  it('the summary decision follows the last list value and the same cap', () => {
    const { result } = renderHook(() => useFinalizingPoll());
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
    const { result } = renderHook(() => useFinalizingPoll());

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
    const { result, rerender } = renderHook(() => useFinalizingPoll());
    const first = result.current;

    rerender();

    expect(result.current.fromList).toBe(first.fromList);
    expect(result.current.forSummary).toBe(first.forSummary);
  });
});
