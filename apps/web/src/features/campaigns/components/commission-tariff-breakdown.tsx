'use client';

import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatPercentDisplay } from '@/lib/format-percent';
import { useMarginColoring } from '@/lib/margin-coloring-context';
import { marginColorStyle } from '@/lib/margin-color-style';
import { cn } from '@/lib/utils';

import type { TariffBreakdown } from '../lib/build-band-breakdown';

export interface CommissionTariffBreakdownProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productTitle: string;
  breakdown: TariffBreakdown;
  /** Final profit-row label; defaults to "Kâr". Custom-price passes "Tahmini kâr". */
  profitLabel?: string;
}

/**
 * Profit detail modal for a price band / custom price — the "what is income vs
 * expense" view the seller opens from the profit badge (mirrors the orders
 * page): sale price (income) − commission − unit cost = profit, with the profit
 * + margin tinted by the user's margin scale. All figures are passed in
 * (MOCK-derived for now); this renders, it never computes.
 */
export function CommissionTariffBreakdown({
  open,
  onOpenChange,
  productTitle,
  breakdown,
  profitLabel,
}: CommissionTariffBreakdownProps): React.ReactElement {
  const t = useTranslations('commissionTariffsPage.breakdown');
  const format = useFormatter();
  const scale = useMarginColoring();
  const profitStyle = marginColorStyle(breakdown.marginPct, scale);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-modal">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>
        <div className="text-muted-foreground text-sm">{productTitle}</div>
        <dl className="gap-2xs flex flex-col text-sm">
          <BreakdownRow label={t('salePrice')}>
            <Currency value={breakdown.price} />
          </BreakdownRow>
          <BreakdownRow
            label={`${t('commission')} (${format.number(breakdown.commissionPct.toNumber(), 'percent')})`}
          >
            <Deduction value={breakdown.commission} />
          </BreakdownRow>
          <BreakdownRow label={t('unitCost')}>
            <Deduction value={breakdown.unitCost} />
          </BreakdownRow>

          <div className="border-border pt-xs mt-3xs gap-2xs flex flex-col border-t">
            <BreakdownRow label={profitLabel ?? t('profit')} emphasis>
              <Currency value={breakdown.profit} emphasis style={profitStyle} />
            </BreakdownRow>
            <BreakdownRow label={t('margin')} muted>
              <span className="tabular-nums" style={profitStyle}>
                {formatPercentDisplay(breakdown.marginPct)}
              </span>
            </BreakdownRow>
          </div>
        </dl>
      </DialogContent>
    </Dialog>
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

/** Deducted amount — display-only "−" glyph (no arithmetic). */
function Deduction({ value }: { value: TariffBreakdown['commission'] }): React.ReactElement {
  return (
    <span className="whitespace-nowrap tabular-nums">
      −<Currency value={value} />
    </span>
  );
}
