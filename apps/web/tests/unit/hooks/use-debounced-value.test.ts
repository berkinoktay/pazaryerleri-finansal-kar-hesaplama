import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDebouncedValue } from '@/features/campaigns/hooks/use-debounced-value';

describe('useDebouncedValue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts at the initial value and surfaces a change only after the delay', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 400), {
      initialProps: { value: 'a' },
    });
    expect(result.current).toBe('a');

    rerender({ value: 'b' });
    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('b');
  });

  it('restarts the wait on every change, so a burst surfaces only its last value', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 400), {
      initialProps: { value: '1' },
    });

    rerender({ value: '12' });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    rerender({ value: '120' });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    // 600ms after the first change, but only 300ms after the last one.
    expect(result.current).toBe('1');

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe('120');
  });
});
