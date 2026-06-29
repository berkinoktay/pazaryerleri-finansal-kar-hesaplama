'use client';

import type { Decimal } from 'decimal.js';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { MarginBadge } from '@/components/patterns/margin-badge';
import { MoneyInput } from '@/components/patterns/money-input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

import { estimateCustomPrice } from '../lib/estimate-custom-price';
import type { CommissionTariffRow } from '../types';

function BreakdownRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/**
 * Custom-price "what-if" field. Owns its own price state so typing never
 * rebuilds the table column defs (which would steal focus). As the seller types,
 * we map the price to the band it falls into and show an estimated profit
 * (margin-colored); clicking it opens a detail modal — like the orders page.
 * MOCK estimate (the backend computes the authoritative value).
 */
export function CustomPriceCell({ row }: { row: CommissionTariffRow }): React.ReactElement {
  const t = useTranslations('commissionTariffsPage');
  const format = useFormatter();
  const [price, setPrice] = React.useState<Decimal | null>(null);

  const estimate = price !== null && price.greaterThan(0) ? estimateCustomPrice(row, price) : null;

  return (
    <div className="gap-3xs flex flex-col">
      <MoneyInput
        value={price}
        onChange={setPrice}
        nonNegative
        aria-label={`${t('table.customPrice')} — ${row.productTitle}`}
        placeholder={t('table.enterPrice')}
        className="max-w-input-narrow"
      />
      {price !== null && estimate !== null ? (
        <Dialog>
          <DialogTrigger asChild>
            <button
              type="button"
              aria-label={t('customPriceModal.openAria')}
              className="gap-3xs focus-visible:shadow-focus flex w-fit items-center rounded text-left focus-visible:outline-none"
            >
              <span className="text-2xs text-muted-foreground">≈</span>
              <MarginBadge value={estimate.profit} marginPct={estimate.marginPct} size="sm" />
            </button>
          </DialogTrigger>
          <DialogContent className="max-w-modal">
            <DialogHeader>
              <DialogTitle>{t('customPriceModal.title')}</DialogTitle>
            </DialogHeader>
            <div className="gap-sm flex flex-col text-sm">
              <div className="text-muted-foreground">{row.productTitle}</div>
              <BreakdownRow
                label={t('customPriceModal.priceLabel')}
                value={<Currency value={price} />}
              />
              <BreakdownRow
                label={t('customPriceModal.bandLabel')}
                value={estimate.band.thresholdLabel}
              />
              <BreakdownRow
                label={t('customPriceModal.commissionLabel')}
                value={format.number(estimate.commissionPct.toNumber(), 'percent')}
              />
              <BreakdownRow
                label={t('customPriceModal.costLabel')}
                value={<Currency value={row.unitCost} />}
              />
              <div className="border-border pt-sm flex items-center justify-between border-t">
                <span className="font-medium">{t('customPriceModal.profitLabel')}</span>
                <MarginBadge value={estimate.profit} marginPct={estimate.marginPct} />
              </div>
            </div>
          </DialogContent>
        </Dialog>
      ) : (
        <span className="text-2xs text-muted-foreground">{t('table.customPriceHint')}</span>
      )}
    </div>
  );
}
