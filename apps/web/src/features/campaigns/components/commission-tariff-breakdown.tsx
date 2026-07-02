'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { ImageCell } from '@/components/patterns/image-cell';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { formatPercentDisplay } from '@/lib/format-percent';
import { useMarginColoring } from '@/lib/margin-coloring-context';
import { marginColorStyle } from '@/lib/margin-color-style';
import { cn } from '@/lib/utils';

import type { EstimateItemPriceResult, QuoteBreakdown } from '../api/estimate-item-price.api';
import { useReasonLabel } from '../hooks/use-reason-label';

export interface CommissionTariffBreakdownProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productTitle: string;
  /** Product image URL (barcode-matched); null/undefined renders the icon fallback. */
  imageUrl?: string | null;
  /** Backend estimate result — null before the first fetch. */
  result: EstimateItemPriceResult | null;
  /** True while the estimate request is in flight. */
  loading: boolean;
  /** Final profit-row label; defaults to "Kâr". Custom-price passes "Tahmini kâr". */
  profitLabel?: string;
}

// Deducted GROSS terms, in the authoritative formula order:
// Satış − Maliyet − Komisyon − Kargo − PSF − Stopaj − Net KDV = Kâr.
// PSF + Stopaj are hidden when '0.00' (noise-free), matching ProfitBreakdownCard.
const DEDUCTION_ROWS = [
  { key: 'cost', amount: 'costGross', hideWhenZero: false },
  { key: 'commission', amount: 'commissionGross', hideWhenZero: false },
  { key: 'shipping', amount: 'shippingGross', hideWhenZero: false },
  { key: 'platformService', amount: 'platformServiceGross', hideWhenZero: true },
  { key: 'stoppage', amount: 'stoppage', hideWhenZero: true },
] as const satisfies ReadonlyArray<{
  key: string;
  amount: keyof QuoteBreakdown;
  hideWhenZero: boolean;
}>;

/**
 * Profit detail modal for a price band / custom price — the full income-vs-expense
 * view the seller opens from the profit badge (mirrors the orders page):
 * Satış − Maliyet − Komisyon − Kargo − PSF − Stopaj − Net KDV = Kâr, with the
 * profit + margin tinted by the user's margin scale. Every figure is
 * backend-computed (the estimate engine); this renders, it never calculates —
 * the "−" glyphs are display only.
 */
export function CommissionTariffBreakdown({
  open,
  onOpenChange,
  productTitle,
  imageUrl,
  result,
  loading,
  profitLabel,
}: CommissionTariffBreakdownProps): React.ReactElement {
  const t = useTranslations('commissionTariffsPage.breakdown');
  const tCommon = useTranslations('common');
  const reasonLabel = useReasonLabel();
  const scale = useMarginColoring();
  const breakdown = result?.breakdown ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-modal">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>
        <div className="gap-xs flex items-center">
          <ImageCell src={imageUrl} alt={productTitle} size="md" />
          <div className="text-muted-foreground text-sm">{productTitle}</div>
        </div>

        {loading ? (
          <BreakdownSkeleton label={tCommon('loading')} />
        ) : breakdown === null ? (
          <p className="text-muted-foreground text-sm">
            {result?.reason != null ? reasonLabel(result.reason) : t('notCalculable')}
          </p>
        ) : (
          <dl className="gap-2xs flex flex-col text-sm">
            <BreakdownRow label={t('sale')}>
              <Currency value={breakdown.saleGross} />
            </BreakdownRow>

            {DEDUCTION_ROWS.filter(
              (row) => !row.hideWhenZero || breakdown[row.amount] !== '0.00',
            ).map((row) => (
              <BreakdownRow
                key={row.key}
                label={
                  row.key === 'commission' && result?.commissionPct != null
                    ? `${t('commission')} (${formatPercentDisplay(result.commissionPct)})`
                    : t(row.key)
                }
              >
                <SignedAmount value={breakdown[row.amount]} positive={false} />
              </BreakdownRow>
            ))}

            <BreakdownRow label={t('netVat')}>
              <SignedAmount value={breakdown.netVat} positive={false} />
            </BreakdownRow>

            <div className="border-border pt-xs mt-3xs gap-2xs flex flex-col border-t">
              <BreakdownRow label={profitLabel ?? t('profit')} emphasis>
                <Currency
                  value={breakdown.netProfit}
                  emphasis
                  style={marginColorStyle(breakdown.saleMarginPct, scale)}
                />
              </BreakdownRow>
              <BreakdownRow label={t('margin')} muted>
                <span
                  className="tabular-nums"
                  style={marginColorStyle(breakdown.saleMarginPct, scale)}
                >
                  {formatPercentDisplay(breakdown.saleMarginPct)}
                </span>
              </BreakdownRow>
            </div>
          </dl>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* Mirrors the loaded <dl> anatomy — sale + the 5 deduction rows + net VAT —
   plus the bordered profit/margin footer, so the modal holds its loaded height
   instead of tripling when the estimate lands. Label widths cycle so the rows
   read as labels of differing length, not a barcode wall. */
const SKELETON_LABEL_WIDTHS = ['w-16', 'w-24', 'w-20', 'w-28', 'w-20', 'w-16', 'w-24'] as const;

function SkeletonRow({ labelWidth }: { labelWidth: string }): React.ReactElement {
  // h-5 matches the loaded text-sm row's line box, so nothing shifts on load.
  return (
    <div className="flex h-5 items-center justify-between gap-4">
      <Skeleton className={cn('h-4', labelWidth)} />
      <Skeleton className="h-4 w-16" />
    </div>
  );
}

function BreakdownSkeleton({ label }: { label: string }): React.ReactElement {
  return (
    <div role="status" aria-busy aria-label={label} className="gap-2xs flex flex-col">
      {SKELETON_LABEL_WIDTHS.map((width, idx) => (
        <SkeletonRow key={idx} labelWidth={width} />
      ))}
      <div className="border-border pt-xs mt-3xs gap-2xs flex flex-col border-t">
        <SkeletonRow labelWidth="w-20" />
        <SkeletonRow labelWidth="w-16" />
      </div>
    </div>
  );
}

function BreakdownRow({
  label,
  children,
  emphasis = false,
  muted = false,
}: {
  label: string;
  children: React.ReactNode;
  emphasis?: boolean;
  muted?: boolean;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className={cn(muted && 'text-muted-foreground', emphasis && 'font-semibold')}>{label}</dt>
      <dd className={cn('tabular-nums', emphasis && 'font-semibold')}>{children}</dd>
    </div>
  );
}

/**
 * Display-only signed amount. The sign is derived from the STRING (net VAT can be
 * negative — input VAT > output — which favours the seller), never computed:
 * we strip the served '-' and print our own glyph so Intl does not double-sign.
 */
function SignedAmount({
  value,
  positive,
}: {
  value: string;
  positive: boolean;
}): React.ReactElement {
  const isNegative = value.startsWith('-');
  const magnitude = isNegative ? value.slice(1) : value;
  const showMinus = positive ? isNegative : !isNegative;
  return (
    <span className="whitespace-nowrap tabular-nums">
      {showMinus ? '−' : '+'}
      <Currency value={magnitude} />
    </span>
  );
}
