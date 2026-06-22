'use client';

import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { DistributionBar, type DistributionSegment } from '@/components/patterns/distribution-bar';
import { ChartSwatch } from '@/components/ui/chart';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

import type { QuoteBreakdown } from '../api/quote-product-pricing.api';

export interface QuoteBreakdownProps {
  breakdown: QuoteBreakdown;
  className?: string;
}

type BreakdownView = 'segment' | 'waterfall';

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
  const magnitude = stripSign(value);
  return (
    <span className="whitespace-nowrap tabular-nums">
      {isNegative ? '+' : '−'}
      <Currency value={magnitude} />
    </span>
  );
}

function stripSign(value: string): string {
  return value.startsWith('-') ? value.slice(1) : value;
}

/**
 * VISUAL proportion only (a bar fill / segment width), NOT a financial figure.
 * Every money amount the seller reads comes verbatim from the backend; this
 * ratio only drives pixel widths. Strips a sign before measuring.
 */
function shareOf(amount: string, total: string | number): number {
  const magnitude = Math.abs(Number(amount));
  const base = typeof total === 'number' ? total : Number(total);
  if (!Number.isFinite(magnitude) || !Number.isFinite(base) || base <= 0) return 0;
  return Math.min(100, (magnitude / base) * 100);
}

/** The deduction lines shared by both views (sale + Net Kâr handled separately). */
interface BreakdownPart {
  id: string;
  label: string;
  /** Unsigned magnitude string (drives bar/segment width). */
  magnitude: string;
  /** Rendered value node (carries the display sign). */
  value: React.ReactElement;
  /** Chart palette token for the segment view. */
  color: string;
}

function useBreakdownParts(breakdown: QuoteBreakdown): BreakdownPart[] {
  const t = useTranslations('features.productPricing.panel.breakdown');
  return [
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
  ];
}

/** Net Kâr highlighted bottom line — shared by both views. */
function NetProfitRow({ breakdown }: { breakdown: QuoteBreakdown }): React.ReactElement {
  const t = useTranslations('features.productPricing.panel.breakdown');
  const isProfit = !breakdown.netProfit.startsWith('-');
  return (
    <div
      className={cn(
        'px-sm py-xs flex items-center justify-between rounded-md',
        isProfit ? 'bg-success-surface' : 'bg-destructive-surface',
      )}
    >
      <span className="text-sm font-semibold">{t('netProfit')}</span>
      <Currency
        value={breakdown.netProfit}
        emphasis
        className={cn(isProfit ? 'text-success' : 'text-destructive')}
      />
    </div>
  );
}

/** Waterfall view — each line's bar length is its share of the sale. */
function WaterfallBreakdown({ breakdown }: { breakdown: QuoteBreakdown }): React.ReactElement {
  const t = useTranslations('features.productPricing.panel.breakdown');
  const parts = useBreakdownParts(breakdown);
  const rows = [
    {
      id: 'sale',
      label: t('sale'),
      magnitude: breakdown.saleGross,
      value: <Currency value={breakdown.saleGross} />,
    },
    ...parts,
  ];
  return (
    <div className="gap-xs flex flex-col">
      {rows.map((row) => (
        <div key={row.id} className="gap-sm flex items-center">
          <span className="text-muted-foreground shrink-0 basis-2/5 truncate text-sm">
            {row.label}
          </span>
          <div className="bg-muted h-1.5 min-w-0 flex-1 overflow-hidden rounded-full">
            <div
              className="bg-muted-foreground h-full rounded-full"
              // runtime-dynamic: bar reflects this line's share of the sale (visual only)
              style={{ width: `${shareOf(row.magnitude, breakdown.saleGross)}%` }}
            />
          </div>
          <span className="text-foreground shrink-0 text-right text-sm tabular-nums">
            {row.value}
          </span>
        </div>
      ))}
      <div className="mt-2xs">
        <NetProfitRow breakdown={breakdown} />
      </div>
    </div>
  );
}

/** Segment view — one stacked bar (deductions + profit) + a colour legend. */
function SegmentBreakdown({ breakdown }: { breakdown: QuoteBreakdown }): React.ReactElement {
  const t = useTranslations('features.productPricing.panel.breakdown');
  const formatter = useFormatter();
  const parts = useBreakdownParts(breakdown);
  const profit = {
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
  };
  const all = [...parts, profit];
  // Normalise to the sum of magnitudes so the segments fill the bar exactly.
  const total = all.reduce((sum, p) => sum + Math.abs(Number(p.magnitude)), 0);
  const segments: DistributionSegment[] = all.map((p) => ({
    label: p.label,
    value: p.value,
    percent: shareOf(p.magnitude, total),
    color: p.color,
  }));

  return (
    <div className="gap-sm flex flex-col">
      <div className="text-muted-foreground flex items-baseline justify-between text-sm">
        <span>{t('sale')}</span>
        <Currency value={breakdown.saleGross} className="text-foreground font-medium" />
      </div>
      <DistributionBar segments={segments} showLegend={false} ariaLabel={t('sale')} />
      {/* Compact two-column legend — keeps the expanded panel short instead of
          stacking seven full-width rows. */}
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

/**
 * QuoteBreakdown renderer with a view toggle: a stacked **segment** bar + legend
 * (default), or a **waterfall** of per-line bars. All values are backend GROSS
 * strings — the frontend does NO money math; bar/segment widths are visual
 * proportions only (see `shareOf`).
 */
export function QuoteBreakdown({ breakdown, className }: QuoteBreakdownProps): React.ReactElement {
  const t = useTranslations('features.productPricing.panel.breakdown');
  const [view, setView] = React.useState<BreakdownView>('segment');

  const handleViewChange = (next: string): void => {
    if (next === 'segment' || next === 'waterfall') setView(next);
  };

  return (
    <div className={cn('gap-sm flex flex-col', className)}>
      <ToggleGroup
        type="single"
        value={view}
        onValueChange={handleViewChange}
        aria-label={t('viewLabel')}
        className="self-end"
      >
        <ToggleGroupItem value="segment" className="text-xs">
          {t('viewSegment')}
        </ToggleGroupItem>
        <ToggleGroupItem value="waterfall" className="text-xs">
          {t('viewBars')}
        </ToggleGroupItem>
      </ToggleGroup>

      {view === 'segment' ? (
        <SegmentBreakdown breakdown={breakdown} />
      ) : (
        <WaterfallBreakdown breakdown={breakdown} />
      )}
    </div>
  );
}
