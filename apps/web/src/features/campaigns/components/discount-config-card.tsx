'use client';

import { Edit02Icon, InformationCircleIcon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';

import type { DiscountListDetail } from '../api/get-discount-list-detail.api';
import { useDescribeDiscountConfig } from '../lib/discount-config';
import { DiscountTypeBadge } from './discount-type-badge';

export interface DiscountConfigCardProps {
  /** The saved list — carries the discount kurgu + its parameters + optional window/order-limit. */
  list: DiscountListDetail;
  /** Opens the config-edit dialog. */
  onEdit: () => void;
}

/**
 * The İndirimler detail's configuration header: the discount kurgu badge + a one-line human
 * summary of the discount ("%20 indirim · ₺1.000,00 üzeri sepet"), the optional order limit and
 * campaign window, and — because every scenario's profit is estimated as if the order were a
 * single-item basket — the assumption note. The "Düzenle" button reopens the config in an edit
 * dialog; saving there recomputes every row's discounted scenario.
 */
export function DiscountConfigCard({ list, onEdit }: DiscountConfigCardProps): React.ReactElement {
  const t = useTranslations('discountsPage.configCard');
  const describe = useDescribeDiscountConfig();
  const formatter = useFormatter();

  // Deterministic parse of the server ISO strings (no `Date.now()`), so server + client render
  // byte-identical — the window shows only when both ends are present (the condition narrows both
  // to non-null strings inside the branch, so no assertion is needed).
  const windowLabel =
    list.startsAt !== null && list.endsAt !== null
      ? t('dateRange', {
          start: formatter.dateTime(new Date(list.startsAt), 'dayTime'),
          end: formatter.dateTime(new Date(list.endsAt), 'dayTime'),
        })
      : null;

  const hasMeta = list.orderLimit !== null || windowLabel !== null;

  return (
    <div className="border-border bg-card gap-sm p-md flex flex-col rounded-lg border">
      <div className="gap-sm flex flex-wrap items-start justify-between">
        <div className="gap-2xs flex min-w-0 flex-col">
          <div className="gap-sm flex flex-wrap items-center">
            <DiscountTypeBadge type={list.discountType} />
            <span className="text-foreground text-sm font-medium">{describe(list)}</span>
          </div>
          {hasMeta ? (
            <div className="gap-md text-2xs text-muted-foreground flex flex-wrap tabular-nums">
              {list.orderLimit !== null ? (
                <span>{t('orderLimit', { count: list.orderLimit })}</span>
              ) : null}
              {windowLabel !== null ? <span>{windowLabel}</span> : null}
            </div>
          ) : null}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={onEdit}
          leadingIcon={<Edit02Icon aria-hidden />}
          className="shrink-0"
        >
          {t('edit')}
        </Button>
      </div>

      <div className="gap-2xs text-2xs text-muted-foreground flex items-start">
        <InformationCircleIcon className="size-icon-xs mt-3xs shrink-0" aria-hidden />
        <span>{t('assumption')}</span>
      </div>
    </div>
  );
}
