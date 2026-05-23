'use client';

import { ArrowDown01Icon, ArrowUp01Icon, CheckmarkCircle02Icon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { EmptyState } from '@/components/patterns/empty-state';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import { type OrderFeeDetail } from '../api/get-order.api';

type Tone = 'neutral' | 'info' | 'warning' | 'success';

const SOURCE_TONES: Record<OrderFeeDetail['source'], Tone> = {
  ESTIMATE: 'info',
  SETTLEMENT: 'success',
  CARGO_INVOICE: 'success',
  USER_OVERRIDE: 'warning',
  MANUAL_ENTRY: 'warning',
};

export interface OrderFeeTimelineProps {
  fees: OrderFeeDetail[];
}

/**
 * Chronological OrderFee timeline. Each row carries the fee type, source
 * provenance (ESTIMATE / SETTLEMENT / CARGO_INVOICE / USER_OVERRIDE /
 * MANUAL_ENTRY), direction icon (DEBIT down, CREDIT up), net + VAT
 * amount, and a confirmed-at footnote when the ESTIMATE has been pair-
 * confirmed by a PaymentOrder entry. The list is rendered as-is — the
 * backend orders by capturedAt asc.
 */
export function OrderFeeTimeline({ fees }: OrderFeeTimelineProps): React.ReactElement {
  const t = useTranslations('orderDetail.fees');
  const formatter = useFormatter();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {fees.length === 0 ? (
          <EmptyState title={t('empty.title')} description={t('empty.description')} />
        ) : (
          <ol className="space-y-sm">
            {fees.map((fee) => (
              <li
                key={fee.id}
                className="gap-md border-border p-md flex items-start rounded-md border"
              >
                <DirectionGlyph direction={fee.direction} />
                <div className="gap-3xs flex flex-1 flex-col">
                  <div className="gap-xs flex flex-wrap items-center">
                    <span className="font-medium">
                      {fee.displayName !== null && fee.displayName.length > 0
                        ? fee.displayName
                        : t(`types.${fee.feeType}`)}
                    </span>
                    <Badge tone={SOURCE_TONES[fee.source]} size="sm">
                      {t(`sources.${fee.source}`)}
                    </Badge>
                  </div>
                  <span className="text-2xs text-muted-foreground tabular-nums">
                    {formatter.dateTime(new Date(fee.capturedAt), 'short')}
                  </span>
                  {fee.confirmedAt !== null ? (
                    <span className="text-2xs text-success gap-3xs inline-flex items-center tabular-nums">
                      <CheckmarkCircle02Icon className="size-icon-xs" />
                      {t('confirmedAt', {
                        date: formatter.dateTime(new Date(fee.confirmedAt), 'short'),
                      })}
                    </span>
                  ) : null}
                </div>
                <div className="text-right">
                  <div
                    className={cn(
                      'gap-3xs flex items-baseline justify-end font-medium tabular-nums',
                      fee.direction === 'DEBIT' ? 'text-destructive' : 'text-success',
                    )}
                  >
                    <span aria-hidden>{fee.direction === 'DEBIT' ? '−' : '+'}</span>
                    <Currency value={fee.amountNet} />
                  </div>
                  <span className="text-2xs text-muted-foreground tabular-nums">
                    {t('vatLabel', {
                      rate: formatter.number(Number(fee.vatRate), 'integer'),
                    })}
                    {' · '}
                    <Currency value={fee.vatAmount} className="inline" />
                  </span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function DirectionGlyph({
  direction,
}: {
  direction: OrderFeeDetail['direction'];
}): React.ReactElement {
  const Icon = direction === 'DEBIT' ? ArrowDown01Icon : ArrowUp01Icon;
  return (
    <span
      aria-hidden
      className={cn(
        'mt-3xs grid size-7 shrink-0 place-items-center rounded-full',
        direction === 'DEBIT'
          ? 'bg-destructive-surface text-destructive'
          : 'bg-success-surface text-success',
      )}
    >
      <Icon className="size-icon-sm" />
    </span>
  );
}
