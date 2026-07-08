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

import { getNotificationSummary } from '../api/get-notification-summary.api';
import {
  decideCoalesce,
  isBusinessToday,
  planToast,
  selectSurvivors,
  shouldPlaySound,
  type NewOrderEvent,
  type NotificationSummaryLike,
} from '../lib/new-order-notification-core';
import { playNotificationDing, resumeNotificationAudio } from '../lib/play-notification-sound';
import { LIVE_POLL_INTERVAL_MS, liveKeys } from '../query-keys';

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

function emitBurstToast(count: number, t: RealtimeTranslator, router: PushRouter): void {
  toast(t('burstTitle', { count }), {
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

    const runWindow = async (): Promise<void> => {
      const events = pending.splice(0, pending.length);
      const decision = decideCoalesce(events);

      let burstTotal = 0;
      let survivors: NotificationSummaryLike[] = [];
      if (decision.mode === 'burst') {
        burstTotal = decision.total;
      } else {
        const fetched = await Promise.all(decision.toFetch.map(fetchSummary));
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
        emitBurstToast(plan.count, translator, pushRouter);
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
      if (!isBusinessToday(event.orderDate, new Date())) return;
      pending.push(event);
      if (coalesceTimer === null) {
        coalesceTimer = setTimeout(() => {
          coalesceTimer = null;
          void runWindow();
        }, COALESCE_WINDOW_MS);
      }
    };

    // Gesture-unlock the audio context on the first user interaction.
    const unlock = (): void => resumeNotificationAudio();
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', unlock, { once: true });
      window.addEventListener('keydown', unlock, { once: true });
    }

    const unsubscribe = subscribeToLivePerformance(storeId, {
      onEvent: scheduleInvalidate,
      onNewOrder,
      onHealthChange: (next) => {
        setHealth((prev) => {
          const wasOutage = prev === 'errored' || prev === 'paused';
          if (next === 'healthy' && wasOutage) invalidateAll();
          return next;
        });
      },
    });

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
      }
      if (coalesceTimer !== null) clearTimeout(coalesceTimer);
      if (invalidateTimer !== null) clearTimeout(invalidateTimer);
      unsubscribe();
    };
  }, [orgId, storeId, queryClient]);

  // Health-gated polling fallback (moved from useLiveRealtime): only while errored.
  React.useEffect(() => {
    if (storeId === null) return;
    if (health !== 'errored') return;
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
