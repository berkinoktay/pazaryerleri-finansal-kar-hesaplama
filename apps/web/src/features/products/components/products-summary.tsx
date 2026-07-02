'use client';

import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { StatCard } from '@/components/patterns/stat-card';
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
  const formatter = useFormatter();

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
      <StatCard
        label={t('totalProducts')}
        value={formatter.number(counts.total, 'integer')}
        context={t('totalContext')}
      />
      {/* Zero is good news on these tiles — "Katalog payı: %0" reads like a
          problem statistic, so the context line switches to an all-clear. */}
      <StatCard
        label={t('missingCost')}
        value={formatter.number(counts.missingCost, 'integer')}
        context={
          counts.missingCost === 0
            ? t('noneMissing')
            : t('ofCatalog', { pct: shareOfCatalog(counts.missingCost) })
        }
      />
      <StatCard
        label={t('missingVat')}
        value={formatter.number(counts.missingVat, 'integer')}
        context={
          counts.missingVat === 0
            ? t('noneMissing')
            : t('ofCatalog', { pct: shareOfCatalog(counts.missingVat) })
        }
      />
    </StatGroup>
  );
}
