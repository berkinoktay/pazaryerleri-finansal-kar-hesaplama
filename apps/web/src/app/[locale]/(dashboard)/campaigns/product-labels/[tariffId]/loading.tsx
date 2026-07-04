'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { PageSkeleton } from '@/components/patterns/page-skeleton';

/**
 * Route-level loading boundary for one Advantage product-label DETAIL page. The
 * page is an async server component that awaits org + store resolution before it
 * even reaches the client; without this file the navigation would freeze on the
 * previous screen until those round-trips settle. Renders the detail page anatomy
 * (back link + header + 4-cell summary strip + data panel) the instant the
 * navigation starts, mirroring the client's own `PageSkeleton` so there is no
 * layout jump when `AdvantageTariffDetailClient` takes over.
 */
export default function ProductLabelDetailLoading(): React.ReactElement {
  const t = useTranslations('common');
  return <PageSkeleton label={t('loading')} withBackLink statCells={4} />;
}
