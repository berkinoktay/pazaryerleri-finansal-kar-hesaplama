'use client';

import { Decimal } from 'decimal.js';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { MoneyInput } from '@/components/patterns/money-input';
import { ProfitBadge } from '@/components/patterns/profit-badge';
import { useMarginColoring } from '@/lib/margin-coloring-context';
import { cn } from '@/lib/utils';

import type { EstimatePlusPriceResult } from '../api/estimate-plus-item-price.api';
import { useEstimatePlusItemPrice } from '../hooks/use-estimate-plus-item-price';
import { useTariffScope } from '../lib/tariff-scope';
import type { PlusTariffDetailItem } from '../types';
import { PlusTariffBreakdown } from './plus-tariff-breakdown';

const DEBOUNCE_MS = 400;

/**
 * Custom Plus-price "what-if" field. The seller tries a Plus price at or below the
 * ceiling (`plus.price`); a debounced backend estimate maps it to the reduced Plus
 * commission and returns the real profit — shown via the shared {@link ProfitBadge}
 * (margin-colored, same chip as orders); clicking it opens the full breakdown
 * modal. The input is capped at the ceiling so the seller cannot enter a price the
 * Plus program would reject. No client-side math: the engine computes the
 * authoritative value (feedback_no_frontend_financial_calculation). Owns its own
 * price state so typing never rebuilds the table column defs (which would steal
 * focus).
 */
export function PlusCustomPriceCell({ row }: { row: PlusTariffDetailItem }): React.ReactElement {
  const t = useTranslations('plusCommissionTariffsPage');
  const tBreakdown = useTranslations('plusCommissionTariffsPage.breakdown');
  const scale = useMarginColoring();
  const scope = useTariffScope();
  const estimate = useEstimatePlusItemPrice(scope.orgId, scope.storeId, scope.tariffId);
  const estimateMutate = estimate.mutate;
  const [price, setPrice] = React.useState<Decimal | null>(null);
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);
  // The Plus offer's ceiling: the seller may try any price up to (and including)
  // it, never above — that is the whole point of the ceiling.
  const ceiling = React.useMemo(() => new Decimal(row.plus.price), [row.plus.price]);
  // Last SUCCESSFUL estimate. `mutate()` resets `estimate.data` to undefined,
  // which would unmount the badge on every debounced keystroke and make the row
  // jump; keeping the previous figures on screen (dimmed while the next request
  // runs) kills that flicker. react-query fires a mutate-level onSuccess only for
  // the LATEST call, so an out-of-order older response can never overwrite a newer
  // estimate.
  const [lastResult, setLastResult] = React.useState<EstimatePlusPriceResult | null>(null);

  // Debounced what-if: fire the estimate ~400ms after the seller stops typing.
  // useEffect is correct here — it syncs an external system (the estimate API) to
  // the typed price, and the cleanup cancels the pending call on each keystroke.
  React.useEffect(() => {
    if (price === null || !price.greaterThan(0)) return undefined;
    const priceStr = price.toFixed(2);
    const handle = setTimeout(() => {
      estimateMutate(
        { itemId: row.id, body: { price: priceStr } },
        { onSuccess: (data) => setLastResult(data) },
      );
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [price, row.id, estimateMutate]);

  const showEstimate = price !== null && price.greaterThan(0) && lastResult !== null;

  return (
    <div className="gap-3xs flex flex-col">
      {/* On mobile the field has no column header, so label it here; the desktop
          table's "Plus Fiyati" column header hides this (md:hidden). */}
      <span className="text-2xs text-muted-foreground font-medium md:hidden">
        {t('table.customPrice')}
      </span>
      <MoneyInput
        value={price}
        onChange={setPrice}
        nonNegative
        max={ceiling}
        aria-label={`${t('table.customPrice')} — ${row.productTitle}`}
        placeholder={t('table.enterPrice')}
        className="md:max-w-input-narrow w-full"
      />
      {showEstimate && lastResult !== null ? (
        <div className="gap-3xs flex flex-col">
          <span className="text-2xs text-muted-foreground">{tBreakdown('estimatedProfit')}</span>
          <ProfitBadge
            value={lastResult.breakdown?.netProfit ?? null}
            marginPct={lastResult.breakdown?.saleMarginPct ?? null}
            scale={scale}
            onOpen={() => setBreakdownOpen(true)}
            showMarginPct
            // Dim (don't unmount) while the next estimate is in flight — the
            // figures update in place with zero layout shift.
            className={cn(
              'duration-fast self-start transition-opacity',
              estimate.isPending && 'opacity-60',
            )}
          />
          <PlusTariffBreakdown
            open={breakdownOpen}
            onOpenChange={setBreakdownOpen}
            productTitle={row.productTitle}
            imageUrl={row.imageUrl}
            result={lastResult}
            loading={estimate.isPending}
            profitLabel={tBreakdown('estimatedProfit')}
          />
        </div>
      ) : (
        <span className="text-2xs text-muted-foreground">{t('table.customPriceHint')}</span>
      )}
    </div>
  );
}
