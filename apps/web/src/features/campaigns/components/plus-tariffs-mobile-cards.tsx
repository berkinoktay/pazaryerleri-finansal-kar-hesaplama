'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { ProductImageCell } from '@/components/patterns/product-image-cell';
import { formatPercentDisplay } from '@/lib/format-percent';

import { usePlusReasonLabel } from '../hooks/use-plus-reason-label';
import type {
  PlusCustomChoice,
  PlusCustomPriceMap,
  PlusSelectionMap,
} from '../lib/plus-bulk-actions';
import type { PlusTariffDetailItem } from '../types';
import { PlusBandCell } from './plus-band-cell';
import { PlusCustomPriceCell } from './plus-custom-price-cell';

export interface PlusTariffsMobileCardsProps {
  rows: readonly PlusTariffDetailItem[];
  selection: PlusSelectionMap;
  customPrices: PlusCustomPriceMap;
  onToggleJoin: (rowId: string) => void;
  onSelectCustom: (rowId: string, choice: PlusCustomChoice) => void;
  onDeselectCustom: (rowId: string) => void;
}

/**
 * Mobile layout: one card per product as a single TOP-TO-BOTTOM flow, so nothing
 * competes horizontally — the seller flagged the old image-left / price-right
 * header as cramped and hard to parse. Four zones, each opened by a top divider rule
 * (border-t) + gap-md so the flat sections read as distinct blocks, not one list:
 *   1. Product identity — image + title + meta + not-calculable reason.
 *   2. Current baseline — "Güncel fiyat" / "Güncel komisyon" as label→value rows.
 *   3. Plus offer — flat, with its own "Plus'e Katıl" select control.
 *   4. Custom Plus price — a what-if input AND a selectable "Bu fiyatı seç" choice.
 * Every selectable option shares the one TariffSelectControl affordance. Shown below
 * the `md` breakpoint; the desktop table is hidden there.
 */
export function PlusTariffsMobileCards({
  rows,
  selection,
  customPrices,
  onToggleJoin,
  onSelectCustom,
  onDeselectCustom,
}: PlusTariffsMobileCardsProps): React.ReactElement {
  const t = useTranslations('plusCommissionTariffsPage');
  const reasonLabel = usePlusReasonLabel();

  return (
    <div className="gap-sm flex flex-col">
      {rows.map((row) => {
        const meta = [
          [row.category, row.brand].filter((v): v is string => v !== null).join(' · '),
          row.stockCode,
        ]
          .filter((v) => v !== null && v !== '')
          .join(' · ');
        return (
          <div
            key={row.id}
            className="border-border bg-card gap-md p-md flex flex-col rounded-lg border"
          >
            {/* Zone 1: product identity — full width, no competing right column. */}
            <div className="gap-sm flex min-w-0 items-start">
              <ProductImageCell url={row.imageUrl} alt={row.productTitle} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-sm font-medium">{row.productTitle}</div>
                {meta !== '' ? (
                  <div className="text-2xs text-muted-foreground tabular-nums">{meta}</div>
                ) : null}
                {!row.calculable && row.reason !== null ? (
                  <div className="text-warning text-2xs mt-3xs">{reasonLabel(row.reason)}</div>
                ) : null}
              </div>
            </div>

            {/* Zone 2: current baseline — plain label→value rows (no box), the
                "do nothing" reference the Plus offer is compared against. A top rule
                separates each zone so the flat sections don't read as one block. */}
            <div className="gap-2xs border-border pt-md flex flex-col border-t">
              <div className="gap-sm flex items-baseline justify-between">
                <span className="text-2xs text-muted-foreground">{t('table.current')}</span>
                <span className="text-sm font-semibold tabular-nums">
                  <Currency value={row.current.price} />
                </span>
              </div>
              <div className="gap-sm flex items-baseline justify-between">
                <span className="text-2xs text-muted-foreground">
                  {t('table.currentCommission')}
                </span>
                <span className="text-2xs font-medium tabular-nums">
                  {formatPercentDisplay(row.current.commissionPct)}
                </span>
              </div>
            </div>

            {/* Zone 3: the Plus offer — flat, with its own "Plus'e Katıl" control. */}
            <div className="border-border pt-md border-t">
              <PlusBandCell
                row={row}
                selected={selection[row.id] === true}
                onToggle={() => onToggleJoin(row.id)}
              />
            </div>

            {/* Zone 4: custom Plus price — a what-if AND a selectable choice. */}
            <div className="border-border pt-md border-t">
              <PlusCustomPriceCell
                row={row}
                isSelected={customPrices[row.id] != null}
                onSelect={(choice) => onSelectCustom(row.id, choice)}
                onDeselect={() => onDeselectCustom(row.id)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
