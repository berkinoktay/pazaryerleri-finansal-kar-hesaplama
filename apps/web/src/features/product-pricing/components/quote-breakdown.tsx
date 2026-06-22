'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { cn } from '@/lib/utils';

import type { QuoteBreakdown } from '../api/quote-product-pricing.api';

export interface QuoteBreakdownProps {
  breakdown: QuoteBreakdown;
  className?: string;
}

/**
 * Gösterim amaçlı işaretli tutar. Aritmetik YOK — değeri aynen Currency'ye
 * iletir, önüne salt glyph olarak "−" koyar (feedback_no_frontend_financial_calculation).
 */
function DeductionAmount({ value }: { value: string }): React.ReactElement {
  return (
    <span className="whitespace-nowrap tabular-nums">
      {'−'}
      <Currency value={value} />
    </span>
  );
}

/**
 * Net KDV: backend'den gelen değer işaretlidir (negatif → satıcı lehine).
 * Magnitude'u Currency'ye verip önüne uygun glyph koyar — aritmetik yok.
 */
function NetVatAmount({ value }: { value: string }): React.ReactElement {
  const isNegative = value.startsWith('-');
  const magnitude = isNegative ? value.slice(1) : value;
  return (
    <span className="whitespace-nowrap tabular-nums">
      {isNegative ? '+' : '−'}
      <Currency value={magnitude} />
    </span>
  );
}

/**
 * VISUAL proportion only (a progress-bar fill width), NOT a financial figure:
 * the magnitude of a line relative to the sale, clamped to 0–100. Every money
 * amount the seller reads still comes verbatim from the backend; this ratio
 * never produces a displayed value. Strips a leading sign before measuring.
 */
function barWidth(amount: string, saleGross: string): number {
  const magnitude = Math.abs(Number(amount));
  const base = Number(saleGross);
  if (!Number.isFinite(magnitude) || !Number.isFinite(base) || base <= 0) return 0;
  return Math.min(100, (magnitude / base) * 100);
}

interface WaterfallLine {
  id: string;
  label: string;
  /** Unsigned magnitude string used for the bar width. */
  magnitude: string;
  /** Rendered value node (carries the display sign). */
  value: React.ReactElement;
}

/**
 * QuoteBreakdown renderer — waterfall: each line carries a bar whose length is
 * its share of the sale, so the seller sees where the price goes at a glance.
 * The sale is the full reference bar; cost/commission/shipping/PSF/stoppage/VAT
 * are proportional deductions; Net Kâr is the highlighted bottom line.
 *
 * All values are backend GROSS strings — the frontend does NO money math; the
 * bar width is a visual proportion (see `barWidth`).
 */
export function QuoteBreakdown({ breakdown, className }: QuoteBreakdownProps): React.ReactElement {
  const t = useTranslations('features.productPricing.panel.breakdown');

  const isProfit = !breakdown.netProfit.startsWith('-');
  const netVatMagnitude = breakdown.netVat.startsWith('-')
    ? breakdown.netVat.slice(1)
    : breakdown.netVat;

  const lines: WaterfallLine[] = [
    {
      id: 'sale',
      label: t('sale'),
      magnitude: breakdown.saleGross,
      value: <Currency value={breakdown.saleGross} />,
    },
    {
      id: 'cost',
      label: t('cost'),
      magnitude: breakdown.costGross,
      value: <DeductionAmount value={breakdown.costGross} />,
    },
    {
      id: 'commission',
      label: t('commission'),
      magnitude: breakdown.commissionGross,
      value: <DeductionAmount value={breakdown.commissionGross} />,
    },
    {
      id: 'shipping',
      label: t('shipping'),
      magnitude: breakdown.shippingGross,
      value: <DeductionAmount value={breakdown.shippingGross} />,
    },
    {
      id: 'platformService',
      label: t('platformService'),
      magnitude: breakdown.platformServiceGross,
      value: <DeductionAmount value={breakdown.platformServiceGross} />,
    },
    {
      id: 'stoppage',
      label: t('stoppage'),
      magnitude: breakdown.stoppage,
      value: <DeductionAmount value={breakdown.stoppage} />,
    },
    {
      id: 'netVat',
      label: t('netVat'),
      magnitude: netVatMagnitude,
      value: <NetVatAmount value={breakdown.netVat} />,
    },
  ];

  return (
    <div className={cn('gap-xs flex flex-col', className)}>
      {lines.map((line) => (
        <div key={line.id} className="gap-sm flex items-center">
          <span className="text-muted-foreground shrink-0 basis-2/5 truncate text-sm">
            {line.label}
          </span>
          <div className="bg-muted h-1.5 min-w-0 flex-1 overflow-hidden rounded-full">
            <div
              className="bg-muted-foreground h-full rounded-full"
              // runtime-dynamic: bar reflects this line's share of the sale (visual only)
              style={{ width: `${barWidth(line.magnitude, breakdown.saleGross)}%` }}
            />
          </div>
          <span className="text-foreground shrink-0 text-right text-sm tabular-nums">
            {line.value}
          </span>
        </div>
      ))}

      {/* Net Kâr — highlighted bottom line (the climax, no bar). */}
      <div
        className={cn(
          'mt-2xs px-sm py-xs flex items-center justify-between rounded-md',
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
    </div>
  );
}
