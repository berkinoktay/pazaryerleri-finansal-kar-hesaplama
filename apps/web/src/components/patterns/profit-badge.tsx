'use client';

import type Decimal from 'decimal.js';
import { InformationCircleIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatPercentDisplay } from '@/lib/format-percent';
import { marginBadgeStyle } from '@/lib/margin-color-style';
import { type MarginScale } from '@/lib/margin-coloring';
import { cn } from '@/lib/utils';

const EMPTY_VALUE = '—';

export interface ProfitBadgeProps {
  /** Estimated profit amount. `null` renders a neutral — but still clickable — em-dash badge. */
  value: Decimal | string | number | null;
  /** Row margin % (percent units, e.g. `'19.35'`) that drives the red→green fill. `null` → neutral. */
  marginPct: string | null;
  /** Active margin scale; `null`/disabled falls back to the built-in default ramp. */
  scale: MarginScale | null;
  /** Opens the profit detail surface (the orders modal / live sheet). */
  onOpen: () => void;
  /**
   * Also print the margin % beside the amount ("₺534,28 · %9,11"). Opt-in for
   * surfaces without a separate margin column (commission-tariff band cards);
   * off by default so existing tables (orders, live) are unchanged.
   */
  showMarginPct?: boolean;
  /**
   * What to render when `value` is `null`. Defaults to a bare em-dash
   * ("—") so existing surfaces (orders, live sheet) are unchanged. Pass a
   * translated node (e.g. "Maliyet girin") where an empty value has a
   * specific, actionable cause the seller should see instead of a mute dash.
   * When provided, the empty chip switches to a warning-soft treatment
   * (`bg-warning-surface text-warning`) so the cause draws the eye — the
   * default em-dash (no `emptyLabel`) stays a mute neutral chip.
   */
  emptyLabel?: React.ReactNode;
  className?: string;
}

/**
 * Clickable, color-filled estimated-profit chip for table cells. The fill hue
 * tracks the row's margin on a red→green scale (the user's scale, else the
 * default ramp), so profitability reads at a glance; clicking opens the row's
 * profit detail. It is a real `<button>` (keyboard-accessible) carrying the
 * Badge visual; the info icon, hover/focus affordances, and an on-hover tooltip
 * (which spells out what the click does) signal it opens a detail view. A `null`
 * amount still renders a neutral, clickable badge so no row is left without a
 * way to open its detail.
 *
 * @useWhen showing an estimated-profit amount in a table cell that should open the order's profit detail
 */
export function ProfitBadge({
  value,
  marginPct,
  scale,
  onOpen,
  showMarginPct = false,
  emptyLabel,
  className,
}: ProfitBadgeProps): React.ReactElement {
  const t = useTranslations('profitBadge');
  // runtime-dynamic: margin-driven tinted fill/text/border (or undefined → neutral chip)
  const style = value === null ? undefined : marginBadgeStyle(marginPct, scale);
  // A null amount with a specific cause (emptyLabel) reads as a warning-soft chip so the
  // reason draws the eye; a bare null (default "—") stays a mute neutral chip so
  // non-tariff surfaces (orders, live sheet) are unchanged.
  const isCausedEmpty = value === null && emptyLabel !== undefined;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onOpen}
          aria-label={t('open')}
          className={cn(
            'group focus-visible:shadow-focus rounded-md focus-visible:outline-none',
            // Dokunmatikte tıklama alanını büyüt — negatif marj layout'u kaydırmaz.
            'pointer-coarse:-m-2xs pointer-coarse:p-2xs',
            className,
          )}
        >
          <Badge
            tone={isCausedEmpty ? 'warning' : 'neutral'}
            variant="surface"
            style={style}
            trailingIcon={
              <InformationCircleIcon
                aria-hidden
                className="duration-fast ease-out-quart opacity-60 transition-opacity group-hover:opacity-100"
              />
            }
            className="duration-fast ease-out-quart cursor-pointer tabular-nums transition-shadow group-hover:shadow-xs"
          >
            {value === null ? (
              (emptyLabel ?? EMPTY_VALUE)
            ) : (
              // The amount is the hero — bold when a margin % rides beside it (the
              // commission-tariff band cards) so the figure leads and the pct reads
              // as a lighter qualifier. Other surfaces (no margin) keep the default weight.
              <span className={cn(showMarginPct && 'font-bold')}>
                <Currency value={value} />
              </span>
            )}
            {showMarginPct && value !== null && marginPct !== null ? (
              // Smaller, lighter margin % beside the amount — no separator dot.
              // whitespace-nowrap so a huge amount never pushes the pct onto its own line.
              <span className="text-2xs ml-3xs font-medium whitespace-nowrap opacity-80">
                {formatPercentDisplay(marginPct)}
              </span>
            ) : null}
          </Badge>
        </button>
      </TooltipTrigger>
      <TooltipContent>{t('tooltip')}</TooltipContent>
    </Tooltip>
  );
}
