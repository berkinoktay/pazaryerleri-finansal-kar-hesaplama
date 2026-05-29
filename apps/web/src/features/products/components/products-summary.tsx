'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { KpiTile } from '@/components/patterns/kpi-tile';
import { StatGroup } from '@/components/patterns/stat-group';
import { Skeleton } from '@/components/ui/skeleton';

interface OverrideCounts {
  total: number;
  missingCost: number;
  missingVat: number;
}

export interface ProductsSummaryProps {
  /** Store-wide catalog counts from the facets endpoint. Undefined while loading. */
  counts: OverrideCounts | undefined;
}

/**
 * Catalog-health KPI strip for the Products page header `summary` slot. Reads
 * the SAME store-wide counts the tab strip uses (facets `overrideCounts`), so
 * the numbers are real, not invented — the KPI value is the headline, the
 * percent-of-catalog context is what the bare tab counts don't show.
 *
 * Three tiles only: a per-product average net-profit tile is intentionally
 * omitted because the page has no reliable aggregate profit figure (most
 * products are missing cost). We don't fabricate a metric to fill a slot.
 *
 * @useWhen surfacing store-wide catalog health (total + missing-data counts) as the Products page header summary
 */
export function ProductsSummary({ counts }: ProductsSummaryProps): React.ReactElement {
  const t = useTranslations('products.summary');

  if (counts === undefined) {
    return (
      <StatGroup aria-hidden>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </StatGroup>
    );
  }

  const shareOfCatalog = (n: number): number =>
    counts.total > 0 ? Math.round((n / counts.total) * 100) : 0;

  return (
    <StatGroup>
      <KpiTile
        label={t('totalProducts')}
        value={{ kind: 'count', amount: counts.total }}
        context={t('totalContext')}
      />
      <KpiTile
        label={t('missingCost')}
        value={{ kind: 'count', amount: counts.missingCost }}
        context={t('ofCatalog', { pct: shareOfCatalog(counts.missingCost) })}
      />
      <KpiTile
        label={t('missingVat')}
        value={{ kind: 'count', amount: counts.missingVat }}
        context={t('ofCatalog', { pct: shareOfCatalog(counts.missingVat) })}
      />
    </StatGroup>
  );
}
