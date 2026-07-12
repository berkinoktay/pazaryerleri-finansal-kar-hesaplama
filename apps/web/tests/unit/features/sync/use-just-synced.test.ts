import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JUST_SYNCED_TTL_MS, useJustSynced } from '@/features/sync/hooks/use-just-synced';

interface Props {
  syncing: boolean;
}

function renderJustSynced(syncing = false) {
  return renderHook((props: Props) => useJustSynced(props.syncing), {
    initialProps: { syncing },
  });
}

describe('useJustSynced', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts idle — no confirmation before any sync settles', () => {
    const { result } = renderJustSynced();
    expect(result.current.justSynced).toBe(false);
  });

  it('raises the flag when a sync settles', () => {
    const { result } = renderJustSynced();

    act(() => {
      result.current.markSynced();
    });

    expect(result.current.justSynced).toBe(true);
  });

  it('clears the flag the instant a new run starts (syncing)', () => {
    const { result, rerender } = renderJustSynced(false);

    act(() => {
      result.current.markSynced();
    });
    expect(result.current.justSynced).toBe(true);

    // A fresh run in flight outranks the previous confirmation.
    rerender({ syncing: true });
    expect(result.current.justSynced).toBe(false);
  });

  it('reverts to the elapsed-time label after the TTL', () => {
    const { result } = renderJustSynced();

    act(() => {
      result.current.markSynced();
    });
    expect(result.current.justSynced).toBe(true);

    act(() => {
      vi.advanceTimersByTime(JUST_SYNCED_TTL_MS);
    });
    expect(result.current.justSynced).toBe(false);
  });
});
