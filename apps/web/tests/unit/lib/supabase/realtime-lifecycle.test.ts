import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { subscribeToLivePerformance, type RealtimeHealth } from '@/lib/supabase/realtime';

// Minimal chainable channel stub: `.on()` returns the channel, `.subscribe(cb)`
// captures the status callback so the test can drive lifecycle transitions, and
// `removeChannel` records the teardown. Each `createClient().channel()` call
// mints a DISTINCT channel object so the identity guard (which compares the
// live channel against the one a late callback closed over) is exercisable — a
// rebuild after a teardown yields a new instance, mirroring supabase-js.
const { createChannelMock, removeChannelMock, subscribeCallbacks } = vi.hoisted(() => {
  const captured: Array<(status: string) => void> = [];
  const createChannel = (): {
    on: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
  } => {
    const channel = {
      on: vi.fn(),
      subscribe: vi.fn(),
    };
    channel.on.mockReturnValue(channel);
    channel.subscribe.mockImplementation((cb: (status: string) => void) => {
      captured.push(cb);
      return channel;
    });
    return channel;
  };
  return {
    createChannelMock: createChannel,
    removeChannelMock: vi.fn(),
    subscribeCallbacks: captured,
  };
});

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    channel: () => createChannelMock(),
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

  it('clears a stale suppressor from a silent teardown so a later real CLOSED still errors', () => {
    const healthLog: RealtimeHealth[] = [];
    const unsubscribe = subscribeToLivePerformance('store-3', {
      onEvent: () => {},
      onHealthChange: (h) => healthLog.push(h),
    });

    // Channel #1 goes live.
    subscribeCallbacks[0]?.('SUBSCRIBED');
    expect(healthLog.at(-1)).toBe('healthy');

    // Tab hides: health -> paused, the suppressor is armed, channel torn down.
    // This teardown emits NO CLOSED (a silent teardown), so the swallow path
    // never runs and the suppressor stays armed.
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(healthLog.at(-1)).toBe('paused');
    expect(removeChannelMock).toHaveBeenCalledTimes(1);

    // Tab returns: buildChannel rebuilds (channel #2). The rebuild must reset the
    // stale suppressor so it can't mask a genuine outage on the new channel.
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    subscribeCallbacks[1]?.('SUBSCRIBED');
    expect(healthLog.at(-1)).toBe('healthy');

    // A real drop on the rebuilt channel MUST surface as 'errored'. If the stale
    // suppressor had leaked past the rebuild, this CLOSED would be swallowed and
    // health would wrongly read 'healthy' while the channel is dead.
    subscribeCallbacks[1]?.('CLOSED');
    expect(healthLog.at(-1)).toBe('errored');

    unsubscribe();
  });

  it("ignores the old channel's delayed CLOSED after a fast hidden->visible rebuild", () => {
    const healthLog: RealtimeHealth[] = [];
    const unsubscribe = subscribeToLivePerformance('store-4', {
      onEvent: () => {},
      onHealthChange: (h) => healthLog.push(h),
    });

    // Channel #1 goes live.
    subscribeCallbacks[0]?.('SUBSCRIBED');
    expect(healthLog.at(-1)).toBe('healthy');

    // Tab hides: health -> paused, suppressor armed, channel #1 torn down. Model
    // the race where the teardown-CLOSED is DELAYED (still in flight) rather than
    // delivered synchronously.
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(healthLog.at(-1)).toBe('paused');
    expect(removeChannelMock).toHaveBeenCalledTimes(1);

    // Tab returns quickly: buildChannel rebuilds (channel #2, a DISTINCT instance).
    // The rebuild resets the suppressor, so the swallow path can no longer catch
    // channel #1's late CLOSED.
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(healthLog.at(-1)).toBe('connecting');

    // The OLD channel #1 now emits its delayed teardown-CLOSED. Without the
    // identity guard this would flip health to 'errored' (a needless invalidate +
    // polling wake). The guard sees channel #1 is no longer the current channel
    // and drops it: health stays 'connecting'.
    subscribeCallbacks[0]?.('CLOSED');
    expect(healthLog.at(-1)).toBe('connecting');
    expect(healthLog).not.toContain('errored');

    // Channel #2 then reaches SUBSCRIBED and health reads 'healthy'.
    subscribeCallbacks[1]?.('SUBSCRIBED');
    expect(healthLog.at(-1)).toBe('healthy');
    expect(healthLog).not.toContain('errored');

    unsubscribe();
  });
});
