'use client';

import { Decimal } from 'decimal.js';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { MoneyInput } from '@/components/patterns/money-input';
import { ProfitBadge } from '@/components/patterns/profit-badge';
import { useMarginColoring } from '@/lib/margin-coloring-context';

import { useEstimateItemPrice } from '../hooks/use-estimate-item-price';
import { useTariffScope } from '../lib/tariff-scope';
import type { CommissionTariffRow } from '../types';
import { CommissionTariffBreakdown } from './commission-tariff-breakdown';

const DEBOUNCE_MS = 400;

/**
 * Custom-price "what-if" field. Owns its own price state so typing never rebuilds
 * the table column defs (which would steal focus). As the seller types, a
 * debounced backend estimate maps the price to its band and returns the real
 * profit — shown via the shared {@link ProfitBadge} (margin-colored, same chip as
 * orders); clicking it opens the full breakdown modal. No client-side math: the
 * engine computes the authoritative value (feedback_no_frontend_financial_calculation).
 */
export function CustomPriceCell({ row }: { row: CommissionTariffRow }): React.ReactElement {
  const t = useTranslations('commissionTariffsPage');
  const tBreakdown = useTranslations('commissionTariffsPage.breakdown');
  const scale = useMarginColoring();
  const scope = useTariffScope();
  const estimate = useEstimateItemPrice(scope.orgId, scope.storeId, scope.tariffId);
  const estimateMutate = estimate.mutate;
  const [price, setPrice] = React.useState<Decimal | null>(null);
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);

  // Debounced what-if: fire the estimate ~400ms after the seller stops typing.
  // useEffect is correct here — it syncs an external system (the estimate API) to
  // the typed price, and the cleanup cancels the pending call on each keystroke.
  React.useEffect(() => {
    if (price === null || !price.greaterThan(0)) return undefined;
    const priceStr = price.toFixed(2);
    const handle = setTimeout(() => {
      estimateMutate({ itemId: row.id, body: { price: priceStr } });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [price, row.id, estimateMutate]);

  const result = estimate.data ?? null;
  const showEstimate = price !== null && price.greaterThan(0) && result !== null;

  return (
    <div className="gap-3xs flex flex-col">
      {/* On mobile the field has no column header, so label it here; the desktop
          table's "Özel Fiyat" column header hides this (md:hidden). */}
      <span className="text-2xs text-muted-foreground font-medium md:hidden">
        {t('table.customPrice')}
      </span>
      <MoneyInput
        value={price}
        onChange={setPrice}
        nonNegative
        // Cap the digits so an absurd what-if price can't stretch the profit
        // badge past the cell and break the row (≈10M TL — far above any real price).
        maxLength={10}
        aria-label={`${t('table.customPrice')} — ${row.productTitle}`}
        placeholder={t('table.enterPrice')}
        className="md:max-w-input-narrow w-full"
      />
      {showEstimate && result !== null ? (
        <div className="gap-3xs flex flex-col">
          <span className="text-2xs text-muted-foreground">{tBreakdown('estimatedProfit')}</span>
          <ProfitBadge
            value={result.breakdown?.netProfit ?? null}
            marginPct={result.breakdown?.saleMarginPct ?? null}
            scale={scale}
            onOpen={() => setBreakdownOpen(true)}
            className="self-start"
          />
          <CommissionTariffBreakdown
            open={breakdownOpen}
            onOpenChange={setBreakdownOpen}
            productTitle={row.productTitle}
            result={result}
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
