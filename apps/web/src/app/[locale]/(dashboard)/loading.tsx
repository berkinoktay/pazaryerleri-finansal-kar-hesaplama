'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { PageSkeleton } from '@/components/patterns/page-skeleton';

/**
 * Route-group loading boundary for every dashboard page. The dashboard pages
 * are async server components that await 1–2 backend round-trips before
 * returning anything — without this file a navigation FREEZES on the previous
 * screen until the new page's fetches resolve. This renders the generic page
 * anatomy (header + data panel, no KPI band — not every page has one and a
 * skeleton should not promise structure that won't come) the instant the
 * navigation starts; pages whose client components own richer loading states
 * take over from here.
 */
export default function DashboardLoading(): React.ReactElement {
  const t = useTranslations('common');
  return <PageSkeleton label={t('loading')} />;
}
