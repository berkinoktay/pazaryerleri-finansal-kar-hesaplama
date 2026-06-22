'use client';

import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { DistributionBar, type DistributionSegment } from '@/components/patterns/distribution-bar';
import { ChartSwatch } from '@/components/ui/chart';
import { cn } from '@/lib/utils';

import type { QuoteBreakdown } from '../api/quote-product-pricing.api';

export interface QuoteBreakdownProps {
  breakdown: QuoteBreakdown;
  className?: string;
}

/** Gösterim amaçlı işaretli tutar — aritmetik YOK, salt "−" glyph + Currency. */
function DeductionAmount({ value }: { value: string }): React.ReactElement {
  return (
    <span className="whitespace-nowrap tabular-nums">
      {'−'}
      <Currency value={value} />
    </span>
  );
}

/** Net KDV işaretlidir (negatif → satıcı lehine); magnitude + uygun glyph. */
function NetVatAmount({ value }: { value: string }): React.ReactElement {
  const isNegative = value.startsWith('-');
  return (
    <span className="whitespace-nowrap tabular-nums">
      {isNegative ? '+' : '−'}
      <Currency value={stripSign(value)} />
    </span>
  );
}

function stripSign(value: string): string {
  return value.startsWith('-') ? value.slice(1) : value;
}

/**
 * VISUAL proportion only (a segment width), NOT a financial figure. Every money
 * amount the seller reads comes verbatim from the backend; this ratio only
 * drives pixel widths. Strips a sign before measuring.
 */
function shareOf(amount: string, total: number): number {
  const magnitude = Math.abs(Number(amount));
  if (!Number.isFinite(magnitude) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, (magnitude / total) * 100);
}

interface BreakdownPart {
  id: string;
  label: string;
  /** Unsigned magnitude string (drives the segment width). */
  magnitude: string;
  /** Rendered value node (carries the display sign). */
  value: React.ReactElement;
  /** Chart palette token for the segment + swatch. */
  color: string;
}

/**
 * QuoteBreakdown renderer — a stacked segment bar (where the sale price goes:
 * cost / commission / shipping / PSF / stoppage / net VAT / Net Kâr) over a
 * compact two-column legend. All values are backend GROSS strings — the
 * frontend does NO money math; segment widths are visual proportions (`shareOf`).
 */
export function QuoteBreakdown({ breakdown, className }: QuoteBreakdownProps): React.ReactElement {
  const t = useTranslations('features.productPricing.panel.breakdown');
  const formatter = useFormatter();

  const parts: BreakdownPart[] = [
    {
      id: 'cost',
      label: t('cost'),
      magnitude: breakdown.costGross,
      value: <DeductionAmount value={breakdown.costGross} />,
      color: 'var(--color-chart-1)',
    },
    {
      id: 'commission',
      label: t('commission'),
      magnitude: breakdown.commissionGross,
      value: <DeductionAmount value={breakdown.commissionGross} />,
      color: 'var(--color-chart-2)',
    },
    {
      id: 'shipping',
      label: t('shipping'),
      magnitude: breakdown.shippingGross,
      value: <DeductionAmount value={breakdown.shippingGross} />,
      color: 'var(--color-chart-3)',
    },
    {
      id: 'platformService',
      label: t('platformService'),
      magnitude: breakdown.platformServiceGross,
      value: <DeductionAmount value={breakdown.platformServiceGross} />,
      color: 'var(--color-chart-4)',
    },
    {
      id: 'stoppage',
      label: t('stoppage'),
      magnitude: breakdown.stoppage,
      value: <DeductionAmount value={breakdown.stoppage} />,
      color: 'var(--color-chart-5)',
    },
    {
      id: 'netVat',
      label: t('netVat'),
      magnitude: stripSign(breakdown.netVat),
      value: <NetVatAmount value={breakdown.netVat} />,
      color: 'var(--color-chart-6)',
    },
    {
      id: 'netProfit',
      label: t('netProfit'),
      magnitude: stripSign(breakdown.netProfit),
      value: (
        <Currency
          value={breakdown.netProfit}
          className={breakdown.netProfit.startsWith('-') ? 'text-destructive' : 'text-success'}
        />
      ),
      color: 'var(--color-success)',
    },
  ];

  // Normalise to the sum of magnitudes so the segments fill the bar exactly.
  const total = parts.reduce((sum, p) => sum + Math.abs(Number(p.magnitude)), 0);
  const segments: DistributionSegment[] = parts.map((p) => ({
    label: p.label,
    value: p.value,
    percent: shareOf(p.magnitude, total),
    color: p.color,
  }));

  return (
    <div className={cn('gap-sm flex flex-col', className)}>
      <div className="text-muted-foreground flex items-baseline justify-between text-sm">
        <span>{t('sale')}</span>
        <Currency value={breakdown.saleGross} className="text-foreground font-medium" />
      </div>
      <DistributionBar segments={segments} showLegend={false} ariaLabel={t('sale')} />
      {/* Compact two-column legend keeps the expanded panel short. */}
      <div className="gap-x-lg gap-y-2xs mt-2xs grid grid-cols-1 sm:grid-cols-2">
        {segments.map((segment) => (
          <div key={segment.label} className="gap-xs flex items-center text-xs">
            <ChartSwatch color={segment.color} />
            <span className="text-muted-foreground min-w-0 flex-1 truncate">{segment.label}</span>
            <span className="text-foreground tabular-nums">{segment.value}</span>
            <span className="text-muted-foreground w-8 shrink-0 text-right tabular-nums">
              {formatter.number(segment.percent / 100, 'percentInt')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
