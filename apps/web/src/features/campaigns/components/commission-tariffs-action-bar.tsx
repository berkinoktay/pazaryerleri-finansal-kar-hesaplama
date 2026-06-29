'use client';

import type { Decimal } from 'decimal.js';
import { DownloadCircle01Icon, SparklesIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { Button } from '@/components/ui/button';

export interface CommissionTariffsActionBarProps {
  selectedCount: number;
  total: number;
  selectedProfit: Decimal;
  onBestAll: () => void;
  onSaveExport: () => void;
}

/**
 * The detail page's emphasised action bar: the current selection summary on the
 * left, the two primary actions (apply best to all, save & download) on the
 * right — the "select → complete → download" flow the seller follows.
 */
export function CommissionTariffsActionBar({
  selectedCount,
  total,
  selectedProfit,
  onBestAll,
  onSaveExport,
}: CommissionTariffsActionBarProps): React.ReactElement {
  const t = useTranslations('commissionTariffsPage.actionBar');
  const tSmart = useTranslations('commissionTariffsPage.smartSelect');
  const tActions = useTranslations('commissionTariffsPage.actions');

  return (
    <div className="border-primary/25 bg-primary-surface gap-sm px-md py-sm flex flex-wrap items-center justify-between rounded-lg border">
      <div className="gap-xs flex flex-wrap items-center text-sm">
        <span className="font-medium tabular-nums">
          {t('selected', { count: selectedCount, total })}
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">{t('profitLabel')}</span>
        <span className="font-semibold tabular-nums">
          <Currency value={selectedProfit} />
        </span>
      </div>
      <div className="gap-xs flex items-center">
        <Button
          variant="outline"
          size="sm"
          onClick={onBestAll}
          leadingIcon={<SparklesIcon aria-hidden />}
        >
          {tSmart('bestAll')}
        </Button>
        <Button size="sm" onClick={onSaveExport} leadingIcon={<DownloadCircle01Icon aria-hidden />}>
          {tActions('saveExport')}
        </Button>
      </div>
    </div>
  );
}
