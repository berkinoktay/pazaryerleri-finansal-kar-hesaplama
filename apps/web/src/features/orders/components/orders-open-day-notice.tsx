'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

import type { OrderListOpenDay } from '../api/list-orders.api';
import {
  LIVE_PERFORMANCE_PATH,
  type OpenDayMatchKind,
  openDayMatchHref,
  openDayMatchKind,
} from '../lib/open-day-match-href';

interface OrdersOpenDayNoticeProps {
  /** The list response's open day; undefined until the first response lands. */
  openDay: OrderListOpenDay | undefined;
  /**
   * Leave out the "today's orders are on live performance" line because the
   * table's empty state already says it (a store whose only orders are today's).
   */
  hideTodayNotice?: boolean;
}

const MATCH_LABEL_KEY: Record<OpenDayMatchKind, 'matchStored' | 'matchCancelled' | 'matchPending'> =
  {
    stored: 'matchStored',
    cancelled: 'matchCancelled',
    pending: 'matchPending',
  };

// Inline text link inside the notice; reaches 44px under a finger. `break-words`
// is meant to keep a long order number from widening a narrow screen; not yet
// checked at 360px (no layout in the test DOM).
const LINK_CLASS = cn(
  'text-primary inline-flex cursor-pointer items-center font-medium break-words',
  'underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none',
  'pointer-coarse:min-h-11',
);

/**
 * Quiet notice above the orders table about the open (today's) business day,
 * which the list leaves out: a note while a completed day is still being
 * finalised, a pointer to live performance while today has orders, and links to
 * today's orders that match the search. Renders nothing when none applies.
 *
 * A polite live region: the finalising note comes and goes with the page's poll,
 * so it must not interrupt a screen reader the way `role="alert"` would.
 */
export function OrdersOpenDayNotice({
  openDay,
  hideTodayNotice = false,
}: OrdersOpenDayNoticeProps): React.ReactElement | null {
  const t = useTranslations('ordersPage.openDay');

  if (openDay === undefined) return null;
  const { finalizing, todayOrderCount, matches } = openDay;
  const showTodayNotice = todayOrderCount > 0 && !hideTodayNotice;
  if (!finalizing && !showTodayNotice && matches.length === 0) return null;

  return (
    <Alert tone="neutral" size="sm" role="status">
      <AlertDescription className="gap-xs flex flex-col">
        {finalizing ? <p>{t('finalizing')}</p> : null}
        {showTodayNotice ? (
          <p className="gap-x-xs flex flex-wrap items-center">
            <span>{t('todayNotice')}</span>
            <Link href={LIVE_PERFORMANCE_PATH} className={LINK_CLASS}>
              {t('todayLink')}
            </Link>
          </p>
        ) : null}
        {matches.length > 0 ? (
          <div className="gap-2xs flex flex-col">
            <p>{t('matchesTitle', { count: matches.length })}</p>
            <ul className="gap-xs flex flex-wrap">
              {matches.map((match) => (
                <li key={`${match.source}:${match.id}`} className="min-w-0">
                  <Link href={openDayMatchHref(match)} className={LINK_CLASS}>
                    {t(MATCH_LABEL_KEY[openDayMatchKind(match)], {
                      orderNumber: match.orderNumber,
                    })}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
