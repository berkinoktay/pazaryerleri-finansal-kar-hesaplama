'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ShoppingBag03Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { formatCurrency } from '@pazarsync/utils';

import { toast } from '@/components/ui/sonner';
import { useRouter } from '@/i18n/navigation';
import { subscribeToLivePerformance, type RealtimeHealth } from '@/lib/supabase/realtime';
import { useOrderSoundPref } from '@/lib/use-order-sound-pref';
import { useCurrentScope } from '@/providers/current-scope';

import { getLiveOrders, type LivePerformanceOrders } from '../api/get-live-orders.api';
import { getNotificationSummary } from '../api/get-notification-summary.api';
import {
  decideCoalesce,
  diffMissedOrders,
  isBusinessToday,
  knownOrderKey,
  planToast,
  selectSurvivors,
  shouldPlaySound,
  type NewOrderEvent,
  type NotificationSummaryLike,
} from '../lib/new-order-notification-core';
import { playNotificationDing, resumeNotificationAudio } from '../lib/play-notification-sound';
import { clearTabBadge, setTabBadge } from '../lib/tab-badge';
import { LIVE_POLL_INTERVAL_MS, LIVE_QUERY_STALE_MS, liveKeys } from '../query-keys';

const COALESCE_WINDOW_MS = 1_200;
const INVALIDATE_DEBOUNCE_MS = 500;
const TOAST_DURATION_MS = 7_000;
const SUMMARY_STALE_MS = 60_000;

// next-intl's useTranslations returns a narrowly-keyed function. We store the
// real translator in a ref so identity changes don't trigger re-subscriptions.
// The ref type uses ReturnType to match next-intl exactly; the module-level
// helpers receive the ref.current value which carries the full next-intl type.
type RealtimeTranslator = ReturnType<typeof useTranslations<'livePerformance.realtime'>>;
type PushRouter = { push: (href: string) => void };

interface NewOrderNotifierContextValue {
  health: RealtimeHealth;
}

const ctx = React.createContext<NewOrderNotifierContextValue | null>(null);

function detailHref(summary: NotificationSummaryLike): string {
  if (summary.source === 'orders' && summary.orderId !== null) {
    return `/live-performance?order=${summary.orderId}`;
  }
  if (summary.source === 'buffer' && summary.bufferId !== null) {
    return `/live-performance?buffer=${summary.bufferId}`;
  }
  return '/live-performance';
}

function emitSingleToast(
  summary: NotificationSummaryLike,
  t: RealtimeTranslator,
  router: PushRouter,
): void {
  const base =
    summary.costStatus === 'costed' && summary.profit !== null
      ? t('profitLine', { profit: formatCurrency(summary.profit) })
      : t('costMissingLine');
  const description =
    summary.platformOrderNumber !== null
      ? `${base} ${t('orderNumberLabel', { number: summary.platformOrderNumber })}`
      : base;

  toast(t('newOrderTitle', { amount: formatCurrency(summary.revenue) }), {
    description,
    icon: <ShoppingBag03Icon className="size-icon-sm" />,
    duration: TOAST_DURATION_MS,
    action: { label: t('detail'), onClick: () => router.push(detailHref(summary)) },
  });
}

function emitBurstToast(
  count: number,
  t: RealtimeTranslator,
  router: PushRouter,
  titleKey: 'burstTitle' | 'catchupTitle',
): void {
  toast(t(titleKey, { count }), {
    icon: <ShoppingBag03Icon className="size-icon-sm" />,
    duration: TOAST_DURATION_MS,
    action: { label: t('detail'), onClick: () => router.push('/live-performance') },
  });
}

/**
 * Global new-order notifier. Mounted once in the dashboard layout so it is
 * active on every page. Owns the single `live-performance:${storeId}` Realtime
 * channel: debounced `liveKeys.all` invalidation (the live page refetches;
 * no-op off-page), health-gated polling fallback, and the coalesce -> fetch ->
 * dedup -> toast/sound pipeline. Health is exposed via `useNewOrderNotifier()`
 * (the live page's status pill reads it; this replaces `useLiveRealtime`).
 *
 * Because the Realtime channel is torn down while the tab is hidden, orders that
 * arrive during that window never reach the live notifier. A tab-return catch-up
 * diffs a fresh live-orders list against the session's known-order set and replays
 * anything missed through the SAME notification window — one coalesced toast/ding
 * for the whole away period.
 */
export function NewOrderNotifierProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const scope = useCurrentScope();
  const orgId = scope.org.id;
  const storeId = scope.store?.id ?? null;

  const queryClient = useQueryClient();
  const t = useTranslations('livePerformance.realtime');
  const router = useRouter();
  const { enabled: soundEnabled } = useOrderSoundPref();

  const [health, setHealth] = React.useState<RealtimeHealth>('connecting');

  // Refs so toast/router/sound identity changes don't re-subscribe the channel.
  const tRef = React.useRef<RealtimeTranslator>(t);
  const routerRef = React.useRef<PushRouter>(router);
  const soundRef = React.useRef(soundEnabled);
  // Latches whether we saw a real outage ('errored'/'paused') so the recovery
  // invalidate fires on the way back to 'healthy'. A ref, not a prev-state
  // compare, because buildChannel reports 'connecting' on every (re)subscribe:
  // a prev-vs-next check would only ever see 'connecting' -> 'healthy' and the
  // tab-return reconcile would be dead code.
  const hadOutageRef = React.useRef(false);
  React.useEffect(() => {
    tRef.current = t;
  }, [t]);
  React.useEffect(() => {
    routerRef.current = router;
  }, [router]);
  React.useEffect(() => {
    soundRef.current = soundEnabled;
  }, [soundEnabled]);

  React.useEffect(() => {
    if (storeId === null) return;

    const seen = new Set<string>();
    const pending: NewOrderEvent[] = [];
    let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
    let invalidateTimer: ReturnType<typeof setTimeout> | null = null;
    let lastDingAt: number | null = null;
    // Cancels an in-flight coalesce window on store/org switch or unmount so a
    // window that already started (fetch in flight) can't fire the previous
    // store's toast — its "Detay" deep-link would resolve in the new store, and
    // its ding could bypass the fresh session's frequency cap.
    let cancelled = false;
    // Session-lived "known orders" set, shared by the live path and the tab-return
    // catch-up: every order the seller has already been shown (live) or accounted
    // for (baseline / catch-up diff) is recorded here so it can never re-toast.
    const knownIds = new Set<string>();
    // Whether the baseline (the current live list at mount) has seeded knownIds.
    // Catch-up refuses to diff against an unprimed (empty) baseline — otherwise a
    // morning's worth of already-seen orders would each look "missed".
    let baselinePrimed = false;
    // Latches that the tab went hidden at least once, so the FIRST foreground mount
    // (never hidden) does not run catch-up — there is nothing to catch up on.
    let wasHidden = false;
    // Running count of notifications the seller has not yet seen because the tab was
    // hidden when they fired. Drives the tab-title badge label (an attention-grabbing
    // i18n string keyed on this count) and resets to 0 on return (visible again).
    let badgeCount = 0;

    const invalidateAll = (): void => {
      void queryClient.invalidateQueries({ queryKey: liveKeys.all });
    };

    const scheduleInvalidate = (): void => {
      if (invalidateTimer !== null) return;
      invalidateTimer = setTimeout(() => {
        invalidateTimer = null;
        invalidateAll();
      }, INVALIDATE_DEBOUNCE_MS);
    };

    const fetchSummary = async (event: NewOrderEvent): Promise<NotificationSummaryLike | null> => {
      try {
        return await queryClient.fetchQuery({
          queryKey: liveKeys.notificationSummary(orgId, storeId, event.table, event.id),
          queryFn: () =>
            getNotificationSummary({ orgId, storeId, source: event.table, id: event.id }),
          staleTime: SUMMARY_STALE_MS,
        });
      } catch {
        // Cross-tenant / deleted / not-yet-visible id -- drop silently. The toast
        // is best-effort, not a guaranteed-delivery channel.
        return null;
      }
    };

    // Fetch the current live-orders list ('all' tab) through the query cache. The
    // live page and both baseline/catch-up share this key, so a staleTime of
    // LIVE_QUERY_STALE_MS reuses the page's already-loaded list instead of hitting
    // the network; the catch-up path passes 0 to force a fresh read on return.
    const fetchLiveOrdersList = (staleTime: number): Promise<LivePerformanceOrders> =>
      queryClient.fetchQuery({
        queryKey: liveKeys.orders(orgId, storeId, 'all'),
        queryFn: () => getLiveOrders({ orgId, storeId, filter: 'all' }),
        staleTime,
      });

    // Seed knownIds from the current live list WITHOUT toasting, so the first
    // tab-return diff compares against a real baseline. Never throws: a failed
    // baseline leaves baselinePrimed false and catch-up re-primes on return.
    const primeBaseline = async (): Promise<void> => {
      try {
        const list = await fetchLiveOrdersList(LIVE_QUERY_STALE_MS);
        if (cancelled) return;
        const diff = diffMissedOrders(list.data, knownIds);
        diff.allKeys.forEach((k) => knownIds.add(k));
        baselinePrimed = true;
      } catch {
        // Baseline stays unprimed; runCatchup retries the prime on the next
        // return. Swallow so a failed fetch never crashes the effect.
      }
    };

    const runNotificationWindow = async (
      events: NewOrderEvent[],
      origin: 'live' | 'catchup',
    ): Promise<void> => {
      if (cancelled) return;
      const decision = decideCoalesce(events);

      let burstTotal = 0;
      let survivors: NotificationSummaryLike[] = [];
      if (decision.mode === 'burst') {
        burstTotal = decision.total;
      } else {
        const fetched = await Promise.all(decision.toFetch.map(fetchSummary));
        // The window may have been cancelled (store switch / unmount) while the
        // summary fetch was in flight — drop the toast/ding for the old store.
        if (cancelled) return;
        const summaries = fetched.filter((s): s is NotificationSummaryLike => s !== null);
        const selection = selectSurvivors(summaries, seen);
        selection.newlySeen.forEach((n) => seen.add(n));
        survivors = selection.survivors;
      }

      const plan = planToast(survivors, burstTotal);
      const translator = tRef.current;
      const pushRouter = routerRef.current;
      if (plan.kind === 'single') {
        emitSingleToast(plan.summary, translator, pushRouter);
      } else if (plan.kind === 'burst') {
        // A catch-up burst is framed as "while you were away", a live burst as the
        // plain "N new orders" count.
        emitBurstToast(
          plan.count,
          translator,
          pushRouter,
          origin === 'catchup' ? 'catchupTitle' : 'burstTitle',
        );
      }

      const now = Date.now();
      if (
        shouldPlaySound({
          soundEnabled: soundRef.current,
          hasNotification: plan.kind !== 'none',
          lastDingAt,
          now,
        })
      ) {
        playNotificationDing();
        lastDingAt = now;
      }

      // Tab-title unread badge. Keep-alive (#453) keeps events flowing while the tab
      // is hidden, so a toast/ding can fire that the seller never sees. When that
      // happens, count it into the title label — the only surface visible in the tab
      // strip while away. The tab-return catch-up windows run while VISIBLE
      // (handleCatchupVisibility resets the count before runCatchup), so they
      // naturally never bump the badge.
      if (
        plan.kind !== 'none' &&
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      ) {
        badgeCount += plan.kind === 'single' ? 1 : plan.count;
        setTabBadge(tRef.current('tabBadge', { count: badgeCount }));
      }
    };

    // Tab-return catch-up: pull the live list fresh and diff it against knownIds to
    // find orders that landed while the channel was torn down (hidden tab), then
    // replay them through the SAME notification window as a live burst so the
    // seller gets ONE coalesced toast for the whole away period.
    const runCatchup = async (): Promise<void> => {
      if (cancelled) return;
      // Fail closed: without a real baseline the diff would treat every existing
      // order as missed (the "20 orders this morning" false storm). If we never
      // primed (the mount fetch failed), re-prime now and bail — the NEXT return
      // diffs against a real baseline.
      if (!baselinePrimed) {
        await primeBaseline();
        return;
      }
      let list: LivePerformanceOrders;
      try {
        list = await fetchLiveOrdersList(0);
      } catch {
        return; // the toast is best-effort; a failed fetch just skips this return
      }
      if (cancelled) return;
      const diff = diffMissedOrders(list.data, knownIds);
      diff.allKeys.forEach((k) => knownIds.add(k));
      if (diff.events.length === 0) return;
      await runNotificationWindow(diff.events, 'catchup');
    };

    const onNewOrder = (event: NewOrderEvent): void => {
      // First gate (C1): drop past-day inserts BEFORE the coalesce window. A
      // midnight buffer flush or a historical-day backfill emits INSERTs whose
      // order_date is not today; letting them into `pending` would inflate the
      // burst counter, which short-circuits the per-summary isToday/seen gates and
      // rains "N new orders" + dings for orders that are not new. Data
      // invalidation runs on the separate onEvent channel (scheduleInvalidate), so
      // dropping the toast here never stalls a refetch.
      // Deliberately NOT filtered: a store's first sync of the day backfills
      // today's orders — those are genuinely today's new orders and should toast.
      if (cancelled) return;
      if (!isBusinessToday(event.orderDate, new Date())) return;
      // Dedup against the shared knownIds set (also written by the catch-up diff):
      // an order shown live must not re-toast on the next tab-return diff, and one
      // already surfaced by catch-up must not double-toast when its (late) INSERT
      // finally arrives. Closes the live<->catch-up race in both directions.
      const key = knownOrderKey(event.table, event.id);
      if (knownIds.has(key)) return;
      knownIds.add(key);
      pending.push(event);
      if (coalesceTimer === null) {
        coalesceTimer = setTimeout(() => {
          coalesceTimer = null;
          void runNotificationWindow(pending.splice(0, pending.length), 'live');
        }, COALESCE_WINDOW_MS);
      }
    };

    // Gesture-unlock the audio context on the first user interaction.
    const unlock = (): void => resumeNotificationAudio();
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', unlock, { once: true });
      window.addEventListener('keydown', unlock, { once: true });
    }

    // Catch-up trigger: the Realtime channel is torn down while the tab is hidden
    // (see realtime.ts), so orders that arrive while away never reach onNewOrder.
    // On return we diff the fresh list against knownIds. The wasHidden latch keeps
    // the first foreground mount (never hidden) from running catch-up.
    const handleCatchupVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        wasHidden = true;
        return;
      }
      if (!wasHidden) return;
      wasHidden = false;
      // The seller is looking again: clear the away-count badge before the catch-up
      // window runs, so any catch-up toast is seen live rather than re-counted.
      badgeCount = 0;
      clearTabBadge();
      void runCatchup();
    };
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleCatchupVisibility);
    }

    // Seed the baseline from the current live list before subscribing, so a
    // tab-return diff has a real known-set to compare against.
    void primeBaseline();

    const unsubscribe = subscribeToLivePerformance(storeId, {
      onEvent: scheduleInvalidate,
      onNewOrder,
      onHealthChange: (next) => {
        // Ref-latched outage tracking (see hadOutageRef): the recovery
        // invalidate fires when we return to 'healthy' after any outage, even
        // though buildChannel emits an interim 'connecting'. The state updater
        // stays pure — the invalidate decision lives here, not inside setHealth.
        if (next === 'errored' || next === 'paused') {
          hadOutageRef.current = true;
        } else if (next === 'healthy' && hadOutageRef.current) {
          hadOutageRef.current = false;
          invalidateAll();
        }
        setHealth(next);
      },
    });

    return () => {
      cancelled = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleCatchupVisibility);
      }
      if (coalesceTimer !== null) clearTimeout(coalesceTimer);
      if (invalidateTimer !== null) clearTimeout(invalidateTimer);
      // Store switch / unmount must not leave a stale badge label on the title.
      clearTabBadge();
      unsubscribe();
    };
  }, [orgId, storeId, queryClient]);

  // Health-gated polling fallback (moved from useLiveRealtime): poll whenever the
  // channel is not delivering — any state that is not 'healthy' or 'paused'
  // ('connecting' included, so a channel stuck mid-handshake still reconciles).
  // 'paused' means the tab is hidden: nobody is watching, so don't poll.
  React.useEffect(() => {
    if (storeId === null) return;
    if (health === 'healthy' || health === 'paused') return;
    const intervalId = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: liveKeys.all });
    }, LIVE_POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [health, storeId, queryClient]);

  const value = React.useMemo<NewOrderNotifierContextValue>(() => ({ health }), [health]);
  return <ctx.Provider value={value}>{children}</ctx.Provider>;
}

export function useNewOrderNotifier(): NewOrderNotifierContextValue {
  const value = React.useContext(ctx);
  if (value === null) {
    throw new Error('useNewOrderNotifier must be used inside NewOrderNotifierProvider');
  }
  return value;
}
