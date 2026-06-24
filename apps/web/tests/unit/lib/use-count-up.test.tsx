import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCountUp } from '@/lib/use-count-up';

afterEach(() => vi.unstubAllGlobals());

function stubReducedMotion(matches: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

describe('useCountUp', () => {
  it('snaps to the target immediately under reduced motion', async () => {
    stubReducedMotion(true);
    const { result } = renderHook(() => useCountUp(100));
    await waitFor(() => expect(result.current).toBe(100));
  });

  it('animates up to the target', async () => {
    stubReducedMotion(false);
    const { result } = renderHook(() => useCountUp(100, { durationMs: 40 }));
    await waitFor(() => expect(result.current).toBe(100), { timeout: 1000 });
  });

  it('reaches a new target when the value changes', async () => {
    stubReducedMotion(false);
    const { result, rerender } = renderHook(({ v }) => useCountUp(v, { durationMs: 40 }), {
      initialProps: { v: 100 },
    });
    await waitFor(() => expect(result.current).toBe(100), { timeout: 1000 });
    rerender({ v: 250 });
    await waitFor(() => expect(result.current).toBe(250), { timeout: 1000 });
  });
});
