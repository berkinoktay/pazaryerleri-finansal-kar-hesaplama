import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { subscribeToLivePerformance, type RealtimeHealth } from '@/lib/supabase/realtime';

// Minimal chainable channel stub: `.on()` returns the channel, `.subscribe(cb)`
// captures the status callback so the test can drive lifecycle transitions, and
// `removeChannel` records the teardown.
const { channelMock, removeChannelMock, subscribeCallbacks } = vi.hoisted(() => {
  const captured: Array<(status: string) => void> = [];
  const channel = {
    on: vi.fn(),
    subscribe: vi.fn(),
  };
  channel.on.mockReturnValue(channel);
  channel.subscribe.mockImplementation((cb: (status: string) => void) => {
    captured.push(cb);
    return channel;
  });
  return { channelMock: channel, removeChannelMock: vi.fn(), subscribeCallbacks: captured };
});

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    channel: () => channelMock,
    removeChannel: removeChannelMock,
  }),
}));

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

describe('subscribeToLivePerformance lifecycle', () => {
  beforeEach(() => {
    subscribeCallbacks.length = 0;
    channelMock.on.mockClear();
    channelMock.subscribe.mockClear();
    removeChannelMock.mockClear();
    setVisibility('visible');
  });

  afterEach(() => {
    setVisibility('visible');
  });

  it('keeps health paused when the tab hides — suppresses the teardown CLOSED', () => {
    const healthLog: RealtimeHealth[] = [];
    const unsubscribe = subscribeToLivePerformance('store-1', {
      onEvent: () => {},
      onHealthChange: (h) => healthLog.push(h),
    });

    // buildChannel reports 'connecting' synchronously on subscribe.
    expect(healthLog).toEqual(['connecting']);

    // The channel goes live.
    subscribeCallbacks[0]?.('SUBSCRIBED');
    expect(healthLog.at(-1)).toBe('healthy');

    // Tab hidden -> reportHealth('paused'), then teardown -> removeChannel.
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(healthLog.at(-1)).toBe('paused');
    expect(removeChannelMock).toHaveBeenCalledTimes(1);

    // supabase-js fires the subscribe callback once with CLOSED as a result of
    // our own teardown. It must be swallowed: health stays 'paused', it never
    // flips to 'errored' (which would wake the polling fallback in a hidden tab).
    subscribeCallbacks[0]?.('CLOSED');
    expect(healthLog.at(-1)).toBe('paused');
    expect(healthLog).not.toContain('errored');

    unsubscribe();
  });

  it('still reports errored for a genuine CLOSED (no preceding teardown)', () => {
    const healthLog: RealtimeHealth[] = [];
    const unsubscribe = subscribeToLivePerformance('store-2', {
      onEvent: () => {},
      onHealthChange: (h) => healthLog.push(h),
    });

    subscribeCallbacks[0]?.('SUBSCRIBED');
    // A real drop with the suppressor unarmed must surface as 'errored'.
    subscribeCallbacks[0]?.('CLOSED');
    expect(healthLog.at(-1)).toBe('errored');

    unsubscribe();
  });
});
