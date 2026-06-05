import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useOrderSoundPref } from '@/lib/use-order-sound-pref';

const KEY = 'pazarsync.live.sound';

// happy-dom's localStorage Proxy methods are inaccessible across the vitest VM
// context boundary (all methods surface as `undefined`). Stub it with a plain
// in-memory implementation -- semantics are identical to the real Web Storage API.
function makeLocalStorageStub() {
  const store: Record<string, string> = {};
  return {
    getItem: (k: string): string | null => (k in store ? store[k]! : null),
    setItem: (k: string, v: string): void => {
      store[k] = String(v);
    },
    removeItem: (k: string): void => {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete store[k];
    },
    clear: (): void => {
      for (const k of Object.keys(store)) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete store[k];
      }
    },
  };
}

describe('useOrderSoundPref', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeLocalStorageStub());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to enabled when nothing is stored', async () => {
    const { result } = renderHook(() => useOrderSoundPref());
    await waitFor(() => expect(result.current.enabled).toBe(true));
  });

  it('reads a stored false', async () => {
    localStorage.setItem(KEY, 'false');
    const { result } = renderHook(() => useOrderSoundPref());
    await waitFor(() => expect(result.current.enabled).toBe(false));
  });

  it('setEnabled(false) persists and updates', async () => {
    const { result } = renderHook(() => useOrderSoundPref());
    await waitFor(() => expect(result.current.enabled).toBe(true));
    act(() => result.current.setEnabled(false));
    expect(localStorage.getItem(KEY)).toBe('false');
    expect(result.current.enabled).toBe(false);
  });

  it('setEnabled(true) persists true', async () => {
    localStorage.setItem(KEY, 'false');
    const { result } = renderHook(() => useOrderSoundPref());
    await waitFor(() => expect(result.current.enabled).toBe(false));
    act(() => result.current.setEnabled(true));
    expect(localStorage.getItem(KEY)).toBe('true');
    expect(result.current.enabled).toBe(true);
  });
});
