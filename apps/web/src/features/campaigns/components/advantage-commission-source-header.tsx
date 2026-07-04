'use client';

import { PercentSquareIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SoftSquareIcon } from '@/components/ui/soft-square-icon';

import { useCommissionTariffLabel } from '../hooks/use-commission-tariff-label';
import { useCommissionTariffList } from '../hooks/use-commission-tariff-list';
import { useUpdateAdvantageCommissionSource } from '../hooks/use-update-advantage-commission-source';
import type { AdvantageCommissionSource, CommissionSourceMode } from '../types';

/** Sentinel radio value for the "Kategori komisyonu" choice — clears the pin. */
const CATEGORY_VALUE = '__category__';

export interface AdvantageCommissionSourceHeaderProps {
  orgId: string;
  storeId: string;
  tariffId: string;
  /** Which commission tariff/period supplies the reduced rates, or null when category commission is used. */
  commissionSource: AdvantageCommissionSource;
  /** pinned (a specific commission tariff) / category (fall back to the category commission). */
  commissionSourceMode: CommissionSourceMode;
}

/**
 * The Advantage vertical's ONE structural novelty made visible: the reduced commission
 * used in every tier's profit is READ from the seller's Commission Tariff data, so the
 * seller must be able to see WHICH tariff/week supplies it — and switch it. In `pinned`
 * mode it shows the resolved source ("Komisyon kaynağı: {dönem} tarifesi"); in `category`
 * mode it shows "Kategori komisyonu" with a muted hint. The "Değiştir" dropdown lists the
 * store's commission tariffs BY DATE plus a "Kategori komisyonu" option; picking a tariff
 * pins it, picking category clears the pin (`commissionSourceTariffId: null`). The
 * mutation invalidates the detail query, so every tier profit recomputes.
 */
export function AdvantageCommissionSourceHeader({
  orgId,
  storeId,
  tariffId,
  commissionSource,
  commissionSourceMode,
}: AdvantageCommissionSourceHeaderProps): React.ReactElement {
  const t = useTranslations('productLabelsPage.commissionSource');
  const commissionList = useCommissionTariffList(orgId, storeId);
  const updateSource = useUpdateAdvantageCommissionSource(orgId, storeId, tariffId);
  const commissionTariffLabel = useCommissionTariffLabel();

  const tariffs = React.useMemo(() => commissionList.data ?? [], [commissionList.data]);

  // `pinned` with a resolved source → the radio sits on that tariff; `category` (or a
  // pin that resolved to nothing) → the radio sits on the "Kategori komisyonu" sentinel.
  const isPinned = commissionSourceMode === 'pinned' && commissionSource !== null;
  const radioValue = isPinned ? commissionSource.tariffId : CATEGORY_VALUE;

  const handleChange = (value: string): void => {
    updateSource.mutate({
      commissionSourceTariffId: value === CATEGORY_VALUE ? null : value,
    });
  };

  return (
    <div className="border-border bg-card gap-sm p-md flex flex-wrap items-center justify-between rounded-lg border">
      <div className="gap-sm flex min-w-0 items-center">
        <SoftSquareIcon shape="circle" variant="soft" tone="info" size="md">
          <PercentSquareIcon />
        </SoftSquareIcon>
        <div className="min-w-0">
          <p className="truncate text-sm">
            <span className="text-muted-foreground">{t('label')} </span>
            <span className="text-foreground font-medium">
              {isPinned
                ? t('sourceValue', {
                    name: commissionSource.tariffName,
                    period: commissionSource.periodLabel,
                  })
                : t('category')}
            </span>
          </p>
          <p className="text-2xs text-muted-foreground">
            {isPinned ? t('pinnedHint') : t('categoryHint')}
          </p>
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" loading={updateSource.isPending}>
            {t('change')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-w-input">
          <DropdownMenuLabel>{t('menuTitle')}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup value={radioValue} onValueChange={handleChange}>
            <DropdownMenuRadioItem value={CATEGORY_VALUE}>{t('category')}</DropdownMenuRadioItem>
            {tariffs.length > 0 ? <DropdownMenuSeparator /> : null}
            {tariffs.map((tariff) => (
              <DropdownMenuRadioItem key={tariff.id} value={tariff.id}>
                {commissionTariffLabel(tariff)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
