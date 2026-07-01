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
  /** Best-case profit — drives the "+X₺ to best" headroom nudge. */
  bestProfit: Decimal;
  onBestAll: () => void;
  onSaveExport: () => void;
}

/**
 * Sticky bottom action bar for an open tariff: a light selection status + a
 * headroom nudge ("+X₺ to best", motivating "apply best to all") on the left,
 * the two primary actions on the right. Floats above the band table so save +
 * the smart action stay reachable while the seller scrolls a long product list.
 * The full profit figures live in the summary strip — this bar stays light.
 */
export function CommissionTariffsActionBar({
  selectedCount,
  total,
  selectedProfit,
  bestProfit,
  onBestAll,
  onSaveExport,
}: CommissionTariffsActionBarProps): React.ReactElement {
  const t = useTranslations('commissionTariffsPage.actionBar');
  const tSmart = useTranslations('commissionTariffsPage.smartSelect');
  const tActions = useTranslations('commissionTariffsPage.actions');

  const headroom = bestProfit.minus(selectedProfit);
  const showHeadroom = headroom.gt(0);

  return (
    <div className="bottom-md sticky z-20">
      <div className="border-border bg-card gap-sm px-md py-sm flex flex-wrap items-center justify-between rounded-lg border shadow-md">
        <div className="gap-sm flex flex-wrap items-center text-sm">
          <span className="font-medium tabular-nums">
            {t('selected', { count: selectedCount, total })}
          </span>
          {showHeadroom ? (
            <span className="text-success gap-2xs text-2xs inline-flex items-center font-medium tabular-nums">
              <SparklesIcon className="size-icon-xs" aria-hidden />
              {t('headroom')} +<Currency value={headroom} />
            </span>
          ) : null}
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
          <Button
            size="sm"
            onClick={onSaveExport}
            leadingIcon={<DownloadCircle01Icon aria-hidden />}
          >
            {tActions('saveExport')}
          </Button>
        </div>
      </div>
    </div>
  );
}
