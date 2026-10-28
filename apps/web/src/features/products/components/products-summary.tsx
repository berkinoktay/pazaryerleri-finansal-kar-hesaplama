'use client';

import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { StatStrip, type StatStripItem } from '@/components/patterns/stat-strip';

interface OverrideCounts {
  total: number;
  missingCost: number;
}

export interface ProductsSummaryProps {
  /** Facets `overrideCounts` over the default listing scope. Undefined while loading. */
  counts: OverrideCounts | undefined;
}

/**
 * Catalog-health KPI strip for the Products page header `summary` slot. Reads
 * the SAME counts the tab strip uses (facets `overrideCounts`, computed over
 * the default listing scope: not delisted, not archived), so "total products"
 * matches the unfiltered list total and "missing cost" matches the
 * missing-cost tab. The percent-of-catalog context is what the bare tab
 * counts don't show.
 *
 * Two tiles only: a per-product average net-profit tile is intentionally
 * omitted because the page has no reliable aggregate profit figure (most
 * products are missing cost). We don't fabricate a metric to fill a slot.
 *
 * Rendered as a bare StatStrip so the framed header owns the surface; while the
 * counts load it shows skeletons but keeps the real labels (no flash of zeros).
 *
 * @useWhen surfacing store catalog health (total + missing-cost counts) as the Products page header summary
 */
export function ProductsSummary({ counts }: ProductsSummaryProps): React.ReactElement {
  const t = useTranslations('products.summary');
  const tCommon = useTranslations('common');
  const formatter = useFormatter();

  const shareOfCatalog = (n: number): number =>
    counts !== undefined && counts.total > 0 ? Math.round((n / counts.total) * 100) : 0;

  // Zero is good news on the missing-cost tile: a 0% share line reads like a
  // problem statistic, so the context line switches to an all-clear.
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
