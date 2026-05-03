import type Decimal from 'decimal.js';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { TrendDelta } from '@/components/patterns/trend-delta';
import { cn } from '@/lib/utils';

/**
 * Currency value paired with an optional period-over-period delta —
 * the canonical surface for monetary metrics inside dashboard tables
 * (orders table net-profit column, products table margin column,
 * settlement reconciliation totals).
 *
 * Composes `Currency` for the value and `TrendDelta` for the delta
 * chip. Both retain their full props (emphasis, dimWhenZero, sizes)
 * — ProfitCell adds the cell-specific concerns: alignment, layout
 * (stacked vs inline), and consistent rhythm between the two.
 *
 * Layouts:
 * - `stacked` (default for tables) — Currency on top, delta below.
 *   Right-aligned by default since financial table columns are.
 * - `inline` — Currency + delta on the same line. Use in row
 *   summaries / KpiTile-adjacent surfaces where vertical space is
 *   tight.
 *
 * For the standalone KPI surface use `KpiTile`; for plain monetary
 * display without a trend use `Currency` directly. Reach for
 * ProfitCell when both pieces of information ship together AND the
 * pairing is repeated across rows / cells.
 *
 * @useWhen rendering a Currency value paired with a TrendDelta chip in a table cell or row summary (use KpiTile for the standalone hero, Currency alone when there is no trend)
 */

export interface ProfitCellProps {
  /** Monetary amount. Decimal preferred. */
  value: Decimal | string | number;
  /** Optional period-over-period delta. Omit for plain currency display. */
  delta?: {
    /** Percent value as a number — `12.4` means +12.4%. */
    percent: Decimal | number;
    /**
     * Semantic direction of a "good" change. Defaults to `'up'`
     * (revenue / profit). Pass `'down'` for cost / refund cells.
     */
    goodDirection?: 'up' | 'down';
  };
  /** Layout variant. Defaults to `'stacked'`. */
  layout?: 'stacked' | 'inline';
  /** Heavier weight on the Currency value. Forwarded to Currency. */
  emphasis?: boolean;
  /** Dim the Currency when zero. Forwarded to Currency. */
  dimWhenZero?: boolean;
  /**
   * Horizontal alignment within the cell. Defaults to `'right'` —
   * financial table columns are right-aligned so digits line up.
   */
  align?: 'left' | 'right';
  className?: string;
}

export function ProfitCell({
  value,
  delta,
  layout = 'stacked',
  emphasis = false,
  dimWhenZero = false,
  align = 'right',
  className,
}: ProfitCellProps): React.ReactElement {
  const alignClass = align === 'right' ? 'text-right items-end' : 'text-left items-start';

  if (layout === 'inline') {
    return (
      <span
        className={cn(
          'gap-xs inline-flex items-baseline',
          align === 'right' ? 'justify-end' : 'justify-start',
          className,
        )}
      >
        <Currency value={value} emphasis={emphasis} dimWhenZero={dimWhenZero} />
        {delta !== undefined ? (
          <TrendDelta value={delta.percent} goodDirection={delta.goodDirection ?? 'up'} />
        ) : null}
      </span>
    );
  }

  return (
    <span className={cn('gap-3xs flex flex-col', alignClass, className)}>
      <Currency value={value} emphasis={emphasis} dimWhenZero={dimWhenZero} />
      {delta !== undefined ? (
        <TrendDelta value={delta.percent} goodDirection={delta.goodDirection ?? 'up'} />
      ) : null}
    </span>
  );
}
