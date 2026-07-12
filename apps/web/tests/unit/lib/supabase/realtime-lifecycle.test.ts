import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DELIVERY_TIMEOUT_MS,
  RESUBSCRIBE_AFTER_MS,
  RESUBSCRIBE_BACKOFF_INITIAL_MS,
  RESUBSCRIBE_BACKOFF_MAX_MS,
  subscribeToLivePerformance,
  subscribeToOrgSyncs,
  type RealtimeHealth,
  type SyncLogRealtimeEvent,
} from '@/lib/supabase/realtime';

// Channel stub harness that SIMULATES realtime-js's topic dedup so the corpse-
// rebuild bug is observable in a unit test. Faithful to two real behaviors:
//
//   1. `client.channel(topic)` DEDUPES BY TOPIC — while a channel with a given
//      topic is still registered (its removeChannel leave has not resolved yet),
//      the same instance is returned rather than a fresh one. Only a not-yet-seen
//      (or already-removed) topic mints a new stub. A reused stub's `.subscribe()`
//      is a no-op (it captures NO new status callback), mirroring realtime-js
//      short-circuiting a re-subscribe on a channel that is already joining/leaving.
//   2. `removeChannel(channel)` unregisters the topic ONLY when its promise
//      resolves. In default mode that promise is resolved immediately; in deferred
//      mode (setDeferRemovals(true)) it stays pending until flushRemovals() runs,
//      modeling the mid-phx_leave window where the corpse is still registered.
//
// The production code suffixes every build's topic with a monotonic generation
// counter, so under the fix each build asks for a distinct topic and always gets a
// fresh stub. If that suffix regressed, a rebuild during an in-flight leave would
// re-request the same topic, the dedup would hand back the corpse, and `.subscribe`
// would capture nothing — which the regression tests below assert against.
//
// The client also exposes `auth.getSession()` and `realtime.setAuth()`: the core
// awaits session hydration before the FIRST channel build (issue #456). The harness
// resolves getSession immediately by default; setDeferGetSession(true) holds it
// pending until resolveGetSession(...) runs, so the hydration-race tests can drive
// the exact ordering.
interface ChannelStub {
  topic: string;
  removed: boolean;
  subscribed: boolean;
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
}

interface MockSession {
  access_token: string;
}

const {
  channelMock,
  removeChannelMock,
  setAuthMock,
  getSessionMock,
  subscribeCallbacks,
  channelBindings,
  setDeferRemovals,
  flushRemovals,
  setDeferGetSession,
  resolveGetSession,
  rejectGetSession,
  resetHarness,
} = vi.hoisted(() => {
  const captured: Array<(status: string) => void> = [];
  // Per-channel list of postgres_changes handlers, in binding order.
  const bindings: Array<Array<(payload: unknown) => void>> = [];
  // Live topic -> stub registry; dedup reads it, removal deletes from it.
  const registry = new Map<string, ChannelStub>();
  // Pending removal finalizers, drained by flushRemovals() when in deferred mode.
  let pendingRemovals: Array<() => void> = [];
  let deferRemovals = false;

  // Auth-session hydration control (issue #456). initialize() awaits
  // supabase.auth.getSession() before the first build; the harness resolves it
  // immediately (default) or defers it (setDeferGetSession) to drive the race tests.
  type GetSessionResult = { data: { session: MockSession | null } };
  const DEFAULT_SESSION: MockSession = { access_token: 'token-fresh' };
  let deferGetSession = false;
  interface PendingGetSession {
    resolve: (session: MockSession | null) => void;
    reject: (error: unknown) => void;
  }
  let pendingGetSessions: PendingGetSession[] = [];

  const getSession = vi.fn((): Promise<GetSessionResult> => {
    if (deferGetSession) {
      return new Promise<GetSessionResult>((resolve, reject) => {
        pendingGetSessions.push({
          resolve: (session) => resolve({ data: { session } }),
          reject,
        });
      });
    }
    return Promise.resolve({ data: { session: DEFAULT_SESSION } });
  });

  // realtime.setAuth is awaited by initialize(); it resolves immediately here. The
  // token argument is not declared on the mock's signature (apps/web's ESLint flags
  // an unused trailing param), but vi.fn still records the actual call args, so the
  // token-assert below via toHaveBeenCalledWith works.
  const setAuth = vi.fn((): Promise<void> => Promise.resolve());

  const mintStub = (topic: string): ChannelStub => {
    const myBindings: Array<(payload: unknown) => void> = [];
    bindings.push(myBindings);
    const stub: ChannelStub = {
      topic,
      removed: false,
      subscribed: false,
      on: vi.fn(),
      subscribe: vi.fn(),
    };
    stub.on.mockImplementation(
      (_event: string, _config: unknown, handler: (payload: unknown) => void) => {
        myBindings.push(handler);
        return stub;
      },
    );
    stub.subscribe.mockImplementation((cb: (status: string) => void) => {
      // A reused (deduped) corpse is already subscribed — re-subscribe is a no-op,
      // so it captures NO new status callback. Only a fresh stub's first subscribe
      // registers a callback the test can drive.
      if (!stub.subscribed) {
        stub.subscribed = true;
        captured.push(cb);
      }
      return stub;
    });
    return stub;
  };

  const channelFor = (topic: string): ChannelStub => {
    const existing = registry.get(topic);
    if (existing !== undefined && !existing.removed) return existing;
    const stub = mintStub(topic);
    registry.set(topic, stub);
    return stub;
  };

  // Wrap channelFor in a vi.fn so tests can read its invocationCallOrder (used to
  // assert setAuth fires BEFORE the first build) and its call count.
  const channel = vi.fn((topic: string): ChannelStub => channelFor(topic));

  const finalizeRemoval = (stub: ChannelStub): void => {
    stub.removed = true;
    if (registry.get(stub.topic) === stub) registry.delete(stub.topic);
  };

  const removeChannel = vi.fn((stub: ChannelStub): Promise<void> => {
    if (deferRemovals) {
      return new Promise<void>((resolve) => {
        pendingRemovals.push(() => {
          finalizeRemoval(stub);
          resolve();
        });
      });
    }
    finalizeRemoval(stub);
    return Promise.resolve();
  });

  return {
    channelMock: channel,
    removeChannelMock: removeChannel,
    setAuthMock: setAuth,
    getSessionMock: getSession,
    subscribeCallbacks: captured,
    channelBindings: bindings,
    setDeferRemovals: (value: boolean): void => {
      deferRemovals = value;
    },
    flushRemovals: (): void => {
      const drained = pendingRemovals;
      pendingRemovals = [];
      for (const finalize of drained) finalize();
    },
    setDeferGetSession: (value: boolean): void => {
      deferGetSession = value;
    },
    resolveGetSession: (session: MockSession | null): void => {
      const drained = pendingGetSessions;
      pendingGetSessions = [];
      for (const pending of drained) pending.resolve(session);
    },
    rejectGetSession: (error: unknown): void => {
      const drained = pendingGetSessions;
      pendingGetSessions = [];
      for (const pending of drained) pending.reject(error);
    },
    resetHarness: (): void => {
      captured.length = 0;
      bindings.length = 0;
      registry.clear();
      pendingRemovals = [];
      deferRemovals = false;
      deferGetSession = false;
      pendingGetSessions = [];
      removeChannel.mockClear();
      channel.mockClear();
      getSession.mockClear();
      setAuth.mockClear();
    },
  };
});

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    channel: channelMock,
    removeChannel: removeChannelMock,
    auth: { getSession: getSessionMock },
    realtime: { setAuth: setAuthMock },
  }),
}));

// Drain the microtask queue so the async initialize() (await getSession -> await
// setAuth -> build) and an awaited teardown->rebuild in attemptResubscribe both run
// to completion. Fake timers do not fake promises, so a handful of awaits is enough
// to walk each chain. A few extra iterations keep it robust as chains grow.
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

beforeEach(() => {
  resetHarness();
  setVisibility('visible');
});

afterEach(() => {
  setVisibility('visible');
  vi.useRealTimers();
});

// Initial-build session hydration (#456). The first channel build is deferred until
// supabase.auth.getSession() resolves so a fresh page load never joins with anon
// claims that RLS silently mutes. These tests exercise that timing directly; the
// suites below simply flush the hydration microtasks (getSession resolves
// immediately) before driving the channel — a timing adaptation, not a behavior
// change, since the delivered assertions are unchanged.
describe('createChannelLifecycle initial session hydration (#456)', () => {
  it('does not build the channel until getSession resolves, then setAuth runs BEFORE the build', async () => {
    setDeferGetSession(true);
    const unsubscribe = subscribeToOrgSyncs('org-hydrate', { onEvent: () => {} });

    // initialize() is suspended awaiting the (still pending) getSession: NO build yet.
    await flushMicrotasks();
    expect(channelMock).not.toHaveBeenCalled();
    expect(subscribeCallbacks).toHaveLength(0);

    // The session hydrates. Now the token is set on the socket, then the channel
    // builds — and setAuth MUST precede the build so the join carries the token.
    resolveGetSession({ access_token: 'token-hydrated' });
    await flushMicrotasks();
    expect(setAuthMock).toHaveBeenCalledWith('token-hydrated');
    expect(channelMock).toHaveBeenCalledTimes(1);
    expect(subscribeCallbacks).toHaveLength(1);
    const setAuthOrder = setAuthMock.mock.invocationCallOrder[0];
    const channelOrder = channelMock.mock.invocationCallOrder[0];
    expect(setAuthOrder).toBeDefined();
    expect(channelOrder).toBeDefined();
    expect(setAuthOrder ?? 0).toBeLessThan(channelOrder ?? 0);

    unsubscribe();
  });

  it('never builds the channel when cleanup() runs while getSession is still pending', async () => {
    setDeferGetSession(true);
    const unsubscribe = subscribeToOrgSyncs('org-cleanup-init', { onEvent: () => {} });
    await flushMicrotasks();

    // Fast unmount before the session resolves: the unsubscribed guard must abort
    // initialize() so no channel is ever built and no token is set.
    unsubscribe();
    resolveGetSession({ access_token: 'token' });
    await flushMicrotasks();

    expect(channelMock).not.toHaveBeenCalled();
    expect(setAuthMock).not.toHaveBeenCalled();
    expect(subscribeCallbacks).toHaveLength(0);
  });

  it('does not double-build when a visibilitychange(visible) lands before getSession resolves', async () => {
    setDeferGetSession(true);
    const unsubscribe = subscribeToOrgSyncs('org-visible-init', { onEvent: () => {} });
    await flushMicrotasks();

    // A visible event arrives while initialize() is still pending. The visible
    // branch must bail on the `initialized` flag (initialize() owns the first
    // build) — otherwise it would race a second build here.
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(channelMock).not.toHaveBeenCalled();

    // Session resolves: exactly ONE build, from initialize().
    resolveGetSession({ access_token: 'token' });
    await flushMicrotasks();
    expect(channelMock).toHaveBeenCalledTimes(1);
    expect(subscribeCallbacks).toHaveLength(1);

    unsubscribe();
  });

  it('still builds the channel when there is no session, without calling setAuth', async () => {
    setDeferGetSession(true);
    const unsubscribe = subscribeToOrgSyncs('org-null-session', { onEvent: () => {} });
    await flushMicrotasks();

    // No build until getSession resolves (would also fail against the pre-fix code
    // that built synchronously at mount).
    expect(channelMock).not.toHaveBeenCalled();

    // No session (token undefined): the build still happens (no worse than the old
    // synchronous behavior), but setAuth is skipped since there is no token.
    resolveGetSession(null);
    await flushMicrotasks();
    expect(setAuthMock).not.toHaveBeenCalled();
    expect(channelMock).toHaveBeenCalledTimes(1);
    expect(subscribeCallbacks).toHaveLength(1);

    unsubscribe();
  });

  it('when the tab hides DURING hydration, skips the hidden build and the visible return builds the channel', async () => {
    setDeferGetSession(true);
    const healthLog: RealtimeHealth[] = [];
    const unsubscribe = subscribeToOrgSyncs('org-hidden-init', {
      onEvent: () => {},
      onHealthChange: (h) => healthLog.push(h),
    });
    await flushMicrotasks();

    // Tab hides while getSession is still pending. handleVisibility reports 'paused'
    // and, with the channel still null, its teardown is a no-op.
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(healthLog.at(-1)).toBe('paused');

    // Session resolves: initialize() must NOT build while hidden -- otherwise a live
    // channel sits in a hidden tab with the watchdog off, and the visible return
    // (channel !== null) would neither rebuild nor arm it.
    resolveGetSession({ access_token: 'token' });
    await flushMicrotasks();
    expect(channelMock).not.toHaveBeenCalled();

    // Returning to visible builds the channel (and, for an opted-in channel, arms
    // the watchdog) through the existing visible-return branch.
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(channelMock).toHaveBeenCalledTimes(1);
    expect(subscribeCallbacks).toHaveLength(1);
    subscribeCallbacks[0]?.('SUBSCRIBED');
    expect(healthLog.at(-1)).toBe('healthy');

    unsubscribe();
  });

  it('degrades to errored and lets the R2b loop rebuild when session hydration rejects', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setDeferGetSession(true);
    const healthLog: RealtimeHealth[] = [];
    const unsubscribe = subscribeToOrgSyncs('org-hydrate-fail', {
      onEvent: () => {},
      onHealthChange: (h) => healthLog.push(h),
    });
    await flushMicrotasks();
    expect(channelMock).not.toHaveBeenCalled();

    // getSession rejects: the catch warns once, degrades health to 'errored', and
    // builds NO channel (the R2b countdown is armed by reportHealth('errored')).
    rejectGetSession(new Error('session hydration failed'));
    await flushMicrotasks();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(healthLog.at(-1)).toBe('errored');
    expect(channelMock).not.toHaveBeenCalled();

    // The ~15s countdown fires -> attemptResubscribe tears down (a no-op, channel is
    // null) and rebuilds a fresh channel: the loop self-heals the failed init.
    await vi.advanceTimersByTimeAsync(RESUBSCRIBE_AFTER_MS);
    expect(channelMock).toHaveBeenCalledTimes(1);
    expect(subscribeCallbacks).toHaveLength(1);

    unsubscribe();
    warnSpy.mockRestore();
  });
});

// These validate the DEFAULT visibility teardown (no keepAliveWhenHidden). They
// run through subscribeToOrgSyncs, the channel that KEEPS that default:
// subscribeToLivePerformance now opts into keep-alive (see the keepAliveWhenHidden
// block below), so its channel no longer tears down on hide. The core teardown /
// suppressor / identity-guard / fast-flip behavior asserted here is unchanged.
describe('createChannelLifecycle visibility teardown (default, no keepAliveWhenHidden)', () => {
  it('keeps health paused when the tab hides — suppresses the teardown CLOSED', async () => {
    const healthLog: RealtimeHealth[] = [];
    const unsubscribe = subscribeToOrgSyncs('org-1', {
      onEvent: () => {},
      onHealthChange: (h) => healthLog.push(h),
    });
    await flushMicrotasks();

    // Once hydration resolves, the first build reports 'connecting' on subscribe.
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

  it('still reports errored for a genuine CLOSED (no preceding teardown)', async () => {
    const healthLog: RealtimeHealth[] = [];
    const unsubscribe = subscribeToOrgSyncs('org-2', {
      onEvent: () => {},
      onHealthChange: (h) => healthLog.push(h),
    });
    await flushMicrotasks();

    subscribeCallbacks[0]?.('SUBSCRIBED');
    // A real drop with the suppressor unarmed must surface as 'errored'.
    subscribeCallbacks[0]?.('CLOSED');
    expect(healthLog.at(-1)).toBe('errored');

    unsubscribe();
  });

  it('clears a stale suppressor from a silent teardown so a later real CLOSED still errors', async () => {
    const healthLog: RealtimeHealth[] = [];
    const unsubscribe = subscribeToOrgSyncs('org-3', {
      onEvent: () => {},
      onHealthChange: (h) => healthLog.push(h),
    });
    await flushMicrotasks();

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

  it("ignores the old channel's delayed CLOSED after a fast hidden->visible rebuild", async () => {
    const healthLog: RealtimeHealth[] = [];
    const unsubscribe = subscribeToOrgSyncs('org-4', {
      onEvent: () => {},
      onHealthChange: (h) => healthLog.push(h),
    });
    await flushMicrotasks();

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

describe('createChannelLifecycle keepAliveWhenHidden (live-performance channel, #452)', () => {
  it('keeps the channel open across a hide->visible cycle: no teardown, never paused, bindings keep firing, no rebuild', async () => {
    const healthLog: RealtimeHealth[] = [];
    const newOrders: Array<{ table: 'orders' | 'buffer'; id: string }> = [];
    const unsubscribe = subscribeToLivePerformance('store-keepalive', {
      onEvent: () => {},
      onNewOrder: (e) => newOrders.push({ table: e.table, id: e.id }),
      onHealthChange: (h) => healthLog.push(h),
    });
    await flushMicrotasks();

    subscribeCallbacks[0]?.('SUBSCRIBED');
    expect(healthLog.at(-1)).toBe('healthy');

    // Tab hidden: keepAliveWhenHidden short-circuits handleVisibility. The channel
    // is NOT removed and health never reads 'paused'.
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(removeChannelMock).not.toHaveBeenCalled();
    expect(healthLog).not.toContain('paused');
    expect(healthLog.at(-1)).toBe('healthy');

    // A binding still delivers events while hidden -> the live toast keeps flowing.
    // channelBindings[0][0] is the live_performance_buffer handler (table 'buffer').
    const bufferHandler = channelBindings[0]?.[0];
    expect(bufferHandler).toBeDefined();
    bufferHandler?.({
      eventType: 'INSERT',
      new: { id: 'ord-hidden', order_date: '2026-07-11' },
      old: {},
    });
    expect(newOrders).toEqual([{ table: 'buffer', id: 'ord-hidden' }]);

    // Tab visible again: the channel was never closed, so the visible branch is
    // skipped — NO rebuild. supabase.channel() is not re-called (no new subscribe
    // callback, no new binding array), and health still never touched 'paused'.
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(subscribeCallbacks).toHaveLength(1);
    expect(channelBindings).toHaveLength(1);
    expect(healthLog).not.toContain('paused');

    unsubscribe();
  });

  it('subscribeToLivePerformance opts INTO keep-alive: the channel survives a hidden tab', async () => {
    const healthLog: RealtimeHealth[] = [];
    const unsubscribe = subscribeToLivePerformance('store-diff-live', {
      onEvent: () => {},
      onHealthChange: (h) => healthLog.push(h),
    });
    await flushMicrotasks();

    subscribeCallbacks[0]?.('SUBSCRIBED');
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));

    expect(removeChannelMock).not.toHaveBeenCalled();
    expect(healthLog).not.toContain('paused');

    unsubscribe();
  });

  it('subscribeToOrgSyncs stays OUT of keep-alive: a hidden tab still tears the channel down', async () => {
    const healthLog: RealtimeHealth[] = [];
    const unsubscribe = subscribeToOrgSyncs('org-diff-sync', {
      onEvent: () => {},
      onHealthChange: (h) => healthLog.push(h),
    });
    await flushMicrotasks();

    subscribeCallbacks[0]?.('SUBSCRIBED');
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));

    expect(removeChannelMock).toHaveBeenCalledTimes(1);
    expect(healthLog.at(-1)).toBe('paused');

    unsubscribe();
  });
});

describe('createChannelLifecycle auto-resubscribe (R2b)', () => {
  it('rebuilds the channel after RESUBSCRIBE_AFTER_MS of continuous errored', async () => {
    vi.useFakeTimers();
    const healthLog: RealtimeHealth[] = [];
    const unsubscribe = subscribeToLivePerformance('store-resub-1', {
      onEvent: () => {},
      onHealthChange: (h) => healthLog.push(h),
    });
    await flushMicrotasks();
    expect(subscribeCallbacks).toHaveLength(1);

    // Channel #1 drops -> the "continuously errored" countdown is armed.
    subscribeCallbacks[0]?.('CHANNEL_ERROR');
    expect(healthLog.at(-1)).toBe('errored');

    // One tick short of the threshold: no teardown, no rebuild.
    await vi.advanceTimersByTimeAsync(RESUBSCRIBE_AFTER_MS - 1_000);
    expect(removeChannelMock).not.toHaveBeenCalled();
    expect(subscribeCallbacks).toHaveLength(1);

    // At the threshold: the dead channel is torn down and, once the awaited leave
    // resolves, a fresh one is built (advanceTimersByTimeAsync flushes the awaits).
    await vi.advanceTimersByTimeAsync(1_000);
    expect(removeChannelMock).toHaveBeenCalledTimes(1);
    expect(subscribeCallbacks).toHaveLength(2);

    unsubscribe();
  });

  it('doubles the backoff between failed rebuilds and caps at RESUBSCRIBE_BACKOFF_MAX_MS', async () => {
    vi.useFakeTimers();
    const unsubscribe = subscribeToLivePerformance('store-resub-2', { onEvent: () => {} });
    await flushMicrotasks();

    // Initial drop, then the first rebuild after the fixed 15s threshold.
    subscribeCallbacks[0]?.('CHANNEL_ERROR');
    await vi.advanceTimersByTimeAsync(RESUBSCRIBE_AFTER_MS);
    expect(subscribeCallbacks).toHaveLength(2); // channel #2

    // Sanity-check the schedule the implementation is expected to walk: the
    // initial backoff doubles each failed attempt and then clamps at the max.
    expect(RESUBSCRIBE_BACKOFF_INITIAL_MS).toBe(5_000);
    expect(RESUBSCRIBE_BACKOFF_MAX_MS).toBe(60_000);
    const expectedBackoffs = [5_000, 10_000, 20_000, 40_000, 60_000, 60_000];

    let channelCount = 2;
    let removeCount = 1;
    for (const backoff of expectedBackoffs) {
      // The freshly built channel also fails to reach SUBSCRIBED.
      subscribeCallbacks[channelCount - 1]?.('CHANNEL_ERROR');
      // One tick short of the current backoff: no rebuild yet.
      await vi.advanceTimersByTimeAsync(backoff - 1_000);
      expect(subscribeCallbacks).toHaveLength(channelCount);
      // Crossing the backoff boundary rebuilds.
      await vi.advanceTimersByTimeAsync(1_000);
      channelCount += 1;
      removeCount += 1;
      expect(subscribeCallbacks).toHaveLength(channelCount);
      expect(removeChannelMock).toHaveBeenCalledTimes(removeCount);
    }

    unsubscribe();
  });

  it('resets the backoff on SUBSCRIBED so a later outage restarts at the initial delay', async () => {
    vi.useFakeTimers();
    const unsubscribe = subscribeToLivePerformance('store-resub-3', { onEvent: () => {} });
    await flushMicrotasks();

    // Walk the backoff up a few steps: 15s -> #2, +5s -> #3, +10s -> #4.
    subscribeCallbacks[0]?.('CHANNEL_ERROR');
    await vi.advanceTimersByTimeAsync(RESUBSCRIBE_AFTER_MS);
    subscribeCallbacks[1]?.('CHANNEL_ERROR');
    await vi.advanceTimersByTimeAsync(RESUBSCRIBE_BACKOFF_INITIAL_MS);
    subscribeCallbacks[2]?.('CHANNEL_ERROR');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(subscribeCallbacks).toHaveLength(4); // channel #4, backoff now elevated (20s)

    // Channel #4 reaches SUBSCRIBED -> the loop is cancelled and the backoff reset.
    subscribeCallbacks[3]?.('SUBSCRIBED');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(subscribeCallbacks).toHaveLength(4); // no further rebuilds while healthy

    // A brand-new outage restarts at the fixed threshold, then the INITIAL
    // backoff (not the elevated 20s) — proving the reset. Advancing only the
    // initial backoff is enough to trigger the next rebuild.
    subscribeCallbacks[3]?.('CHANNEL_ERROR');
    await vi.advanceTimersByTimeAsync(RESUBSCRIBE_AFTER_MS);
    expect(subscribeCallbacks).toHaveLength(5); // channel #5
    subscribeCallbacks[4]?.('CHANNEL_ERROR');
    await vi.advanceTimersByTimeAsync(RESUBSCRIBE_BACKOFF_INITIAL_MS);
    expect(subscribeCallbacks).toHaveLength(6); // channel #6 at the reset (initial) backoff

    unsubscribe();
  });

  it('cancels a pending resubscribe when the tab hides and never rebuilds while paused', async () => {
    vi.useFakeTimers();
    const healthLog: RealtimeHealth[] = [];
    // subscribeToOrgSyncs — the default-teardown channel (live-performance keeps
    // alive on hide now, so 'paused' never fires there; see keepAliveWhenHidden).
    const unsubscribe = subscribeToOrgSyncs('org-resub-paused', {
      onEvent: () => {},
      onHealthChange: (h) => healthLog.push(h),
    });
    await flushMicrotasks();

    // Channel drops -> the 15s resubscribe countdown is armed.
    subscribeCallbacks[0]?.('CHANNEL_ERROR');
    expect(healthLog.at(-1)).toBe('errored');

    // Tab hides before the countdown elapses -> paused + teardown + countdown cancelled.
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(healthLog.at(-1)).toBe('paused');
    expect(removeChannelMock).toHaveBeenCalledTimes(1);

    // Far past the threshold and every backoff step: NO rebuild while hidden.
    await vi.advanceTimersByTimeAsync(300_000);
    expect(subscribeCallbacks).toHaveLength(1);
    expect(removeChannelMock).toHaveBeenCalledTimes(1);
    expect(healthLog).not.toContain('healthy');

    unsubscribe();
  });

  it('neutralizes a queued resubscribe after cleanup: no rebuild fires post-unsubscribe', async () => {
    vi.useFakeTimers();
    const unsubscribe = subscribeToLivePerformance('store-cleanup-race', { onEvent: () => {} });
    await flushMicrotasks();

    // Arm the errored countdown, then tear the whole subscription down.
    subscribeCallbacks[0]?.('CHANNEL_ERROR');
    unsubscribe();
    // cleanup() runs its own teardown -> removeChannel exactly once.
    expect(removeChannelMock).toHaveBeenCalledTimes(1);

    // Even far past every threshold, the queued countdown must NOT rebuild: the
    // timer was cleared by cleanup and attemptResubscribe also bails on `unsubscribed`.
    await vi.advanceTimersByTimeAsync(300_000);
    expect(subscribeCallbacks).toHaveLength(1);
    expect(removeChannelMock).toHaveBeenCalledTimes(1);
  });

  it('treats a delivered event as liveness: a real event cancels the errored countdown (no teardown)', async () => {
    vi.useFakeTimers();
    const healthLog: RealtimeHealth[] = [];
    const unsubscribe = subscribeToLivePerformance('store-liveness', {
      onEvent: () => {},
      onHealthChange: (h) => healthLog.push(h),
    });
    await flushMicrotasks();

    // Channel drops -> the 15s resubscribe countdown is armed.
    subscribeCallbacks[0]?.('CHANNEL_ERROR');
    expect(healthLog.at(-1)).toBe('errored');

    // A real event is delivered mid-countdown (t=10s). Delivery IS liveness, so
    // health recovers to 'healthy' and the pending countdown is cleared.
    await vi.advanceTimersByTimeAsync(10_000);
    const handler = channelBindings[0]?.[0];
    expect(handler).toBeDefined();
    handler?.({ eventType: 'INSERT', new: { id: 'ord-1', order_date: '2026-07-11' }, old: {} });
    expect(healthLog.at(-1)).toBe('healthy');

    // Past the original 15s threshold: NO teardown, NO rebuild -- the recovered
    // channel is left in place.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(removeChannelMock).not.toHaveBeenCalled();
    expect(subscribeCallbacks).toHaveLength(1);

    unsubscribe();
  });

  it('resubscribe yields a genuinely NEW subscribed channel even with a deferred leave (corpse-dedup regression)', async () => {
    // REGRESSION for the corpse-rebuild bug: with removeChannel deferred (modeling
    // the mid-phx_leave window where the old topic is still registered), the rebuild
    // must end up on a fresh channel — a new subscribe callback that drives to
    // 'healthy'. On the pre-fix code the rebuild re-requested the same topic, the
    // dedup handed back the still-registered corpse, .subscribe() no-op'd, and NO
    // new callback was captured (this assertion would fail).
    vi.useFakeTimers();
    setDeferRemovals(true);
    const healthLog: RealtimeHealth[] = [];
    const unsubscribe = subscribeToLivePerformance('store-corpse-resub', {
      onEvent: () => {},
      onHealthChange: (h) => healthLog.push(h),
    });
    await flushMicrotasks();

    // Channel #1 joins, then drops -> the errored countdown is armed.
    subscribeCallbacks[0]?.('SUBSCRIBED');
    expect(healthLog.at(-1)).toBe('healthy');
    subscribeCallbacks[0]?.('CHANNEL_ERROR');
    expect(healthLog.at(-1)).toBe('errored');

    // Countdown fires -> attemptResubscribe awaits teardown, whose removeChannel is
    // deferred (pending). Because the rebuild AWAITS the leave, no new channel yet.
    await vi.advanceTimersByTimeAsync(RESUBSCRIBE_AFTER_MS);
    expect(removeChannelMock).toHaveBeenCalledTimes(1);
    expect(subscribeCallbacks).toHaveLength(1);

    // Resolve the deferred leave; the awaited teardown completes and the rebuild
    // runs on a distinct (generation-suffixed) topic -> a genuinely fresh channel.
    flushRemovals();
    await flushMicrotasks();
    expect(subscribeCallbacks).toHaveLength(2);

    // The new channel is real: driving it to SUBSCRIBED reads healthy.
    subscribeCallbacks[1]?.('SUBSCRIBED');
    expect(healthLog.at(-1)).toBe('healthy');

    unsubscribe();
  });

  it('visibility fast-flip mints a fresh working channel before the leave resolves (corpse-dedup regression)', async () => {
    // REGRESSION for the visibility hide->fast-visible race: the hide starts an
    // (un-awaited) teardown whose deferred removeChannel leaves the old topic
    // registered; the immediate visible rebuilds synchronously. The build must NOT
    // re-acquire the corpse — the generation-suffixed topic guarantees a fresh
    // channel. Pre-fix, the same topic would be re-requested and the dedup would
    // hand back the still-registered leaving channel, capturing NO new callback.
    setDeferRemovals(true);
    const healthLog: RealtimeHealth[] = [];
    // subscribeToOrgSyncs — the default-teardown channel, since this exercises the
    // hide->fast-visible rebuild that keep-alive channels no longer perform.
    const unsubscribe = subscribeToOrgSyncs('org-corpse-flip', {
      onEvent: () => {},
      onHealthChange: (h) => healthLog.push(h),
    });
    await flushMicrotasks();

    subscribeCallbacks[0]?.('SUBSCRIBED');
    expect(healthLog.at(-1)).toBe('healthy');

    // Hide: teardown starts, removeChannel deferred (pending), channel nulled.
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(healthLog.at(-1)).toBe('paused');
    expect(removeChannelMock).toHaveBeenCalledTimes(1);

    // Immediate visible BEFORE the leave resolves -> synchronous rebuild on a fresh
    // topic. A new subscribe callback (#2) is captured; the corpse (#1) is not reused.
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(subscribeCallbacks).toHaveLength(2);

    // The fresh channel reaches SUBSCRIBED and reads healthy.
    subscribeCallbacks[1]?.('SUBSCRIBED');
    expect(healthLog.at(-1)).toBe('healthy');

    unsubscribe();
  });
});

describe('createChannelLifecycle delivery watchdog (R2c)', () => {
  it('degrades healthy -> errored when delivery stalls while expected, and SUBSCRIBED resets the clock', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const healthLog: RealtimeHealth[] = [];
    const unsubscribe = subscribeToOrgSyncs('org-watchdog', {
      onEvent: () => {},
      onHealthChange: (h) => healthLog.push(h),
      expectDelivery: () => true,
    });
    await flushMicrotasks();

    // Channel joins -> healthy; the watchdog clock is reset to the join instant.
    subscribeCallbacks[0]?.('SUBSCRIBED');
    expect(healthLog.at(-1)).toBe('healthy');

    // Before the delivery timeout elapses: no degrade.
    vi.advanceTimersByTime(DELIVERY_TIMEOUT_MS - 1_000);
    expect(healthLog.at(-1)).toBe('healthy');

    // Past the timeout with delivery expected and no events -> degrade to errored.
    vi.advanceTimersByTime(10_000);
    expect(healthLog.at(-1)).toBe('errored');
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // A fresh SUBSCRIBED resets the clock: it must not instantly re-trip within
    // another full timeout window.
    subscribeCallbacks[0]?.('SUBSCRIBED');
    expect(healthLog.at(-1)).toBe('healthy');
    vi.advanceTimersByTime(DELIVERY_TIMEOUT_MS - 5_000);
    expect(healthLog.at(-1)).toBe('healthy');
    expect(warnSpy).toHaveBeenCalledTimes(1); // still just the one degrade warn

    unsubscribe();
    warnSpy.mockRestore();
  });

  it('does not degrade while expectDelivery() returns false, even past the timeout', async () => {
    vi.useFakeTimers();
    const healthLog: RealtimeHealth[] = [];
    const unsubscribe = subscribeToOrgSyncs('org-watchdog-idle', {
      onEvent: () => {},
      onHealthChange: (h) => healthLog.push(h),
      expectDelivery: () => false,
    });
    await flushMicrotasks();

    subscribeCallbacks[0]?.('SUBSCRIBED');
    expect(healthLog.at(-1)).toBe('healthy');

    // No delivery expected -> the watchdog stays quiet no matter how long it is idle.
    vi.advanceTimersByTime(120_000);
    expect(healthLog.at(-1)).toBe('healthy');

    unsubscribe();
  });
});

describe('subscribeToOrgSyncs wire cast guard (R2d)', () => {
  it('skips a malformed sync_logs row with a single warn and lets well-formed rows through', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const events: SyncLogRealtimeEvent[] = [];
    const unsubscribe = subscribeToOrgSyncs('org-guard', {
      onEvent: (e) => events.push(e),
    });
    await flushMicrotasks();

    const handler = channelBindings[0]?.[0];
    expect(handler).toBeDefined();

    // Malformed: empty id -> skipped, one warn, no event emitted.
    handler?.({ eventType: 'INSERT', new: { id: '', status: 'RUNNING' }, old: {} });
    // Malformed: non-string status -> skipped; the one-time flag keeps it at one warn.
    handler?.({ eventType: 'INSERT', new: { id: 'x', status: 42 }, old: {} });
    expect(events).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // Well-formed INSERT -> mapped snake->camel and forwarded to onEvent.
    handler?.({
      eventType: 'INSERT',
      new: {
        id: 'log-ok',
        organization_id: 'org-guard',
        store_id: 'store-1',
        sync_type: 'PRODUCTS',
        status: 'RUNNING',
        started_at: '2026-07-11T00:00:00Z',
        completed_at: null,
        records_processed: 0,
        progress_current: 1,
        progress_total: 10,
        progress_stage: 'upserting',
        error_code: null,
        error_message: null,
        attempt_count: 0,
        next_attempt_at: null,
        skipped_pages: null,
      },
      old: {},
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe('log-ok');
    expect(events[0]?.row?.status).toBe('RUNNING');
    expect(warnSpy).toHaveBeenCalledTimes(1); // still the single warn

    unsubscribe();
    warnSpy.mockRestore();
  });
});
