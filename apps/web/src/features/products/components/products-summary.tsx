'use client';

import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { StatStrip, type StatStripItem } from '@/components/patterns/stat-strip';

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
 * Rendered as a bare StatStrip so the framed header owns the surface; while the
 * counts load it shows skeletons but keeps the real labels (no flash of zeros).
 *
 * @useWhen surfacing store-wide catalog health (total + missing-data counts) as the Products page header summary
 */
export function ProductsSummary({ counts }: ProductsSummaryProps): React.ReactElement {
  const t = useTranslations('products.summary');
  const tCommon = useTranslations('common');
  const formatter = useFormatter();

  const shareOfCatalog = (n: number): number =>
    counts !== undefined && counts.total > 0 ? Math.round((n / counts.total) * 100) : 0;

  // Zero is good news on the missing-data tiles — "Katalog payı: %0" reads like
  // a problem statistic, so the context line switches to an all-clear.
  const missingContext = (n: number): React.ReactNode =>
    n === 0 ? t('noneMissing') : t('ofCatalog', { pct: shareOfCatalog(n) });

  const items: StatStripItem[] = [
    {
      label: t('totalProducts'),
      value: counts !== undefined ? formatter.number(counts.total, 'integer') : null,
      context: counts !== undefined ? t('totalContext') : undefined,
    },
    {
      label: t('missingCost'),
      value: counts !== undefined ? formatter.number(counts.missingCost, 'integer') : null,
      context: counts !== undefined ? missingContext(counts.missingCost) : undefined,
    },
    {
      label: t('missingVat'),
      value: counts !== undefined ? formatter.number(counts.missingVat, 'integer') : null,
      context: counts !== undefined ? missingContext(counts.missingVat) : undefined,
    },
  ];

  return (
    <StatStrip
      surface="bare"
      size="md"
      items={items}
      loading={counts === undefined}
      loadingLabel={tCommon('loading')}
    />
  );
}
