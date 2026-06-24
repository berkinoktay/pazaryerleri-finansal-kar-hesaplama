'use client';

import { Alert02Icon, Cancel01Icon, DownloadSquare02Icon, Search01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import type { DateRange } from 'react-day-picker';

import { DateRangePicker } from '@/components/patterns/date-range-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import {
  ORDER_STATUSES,
  RECONCILIATION_STATUSES,
  type OrderStatusValue,
  type ReconciliationStatusValue,
} from '../lib/orders-filter-parsers';

// Sentinel value used by the Select primitives because Radix forbids empty
// string as a SelectItem value (it conflicts with the "no selection" state).
const ALL_VALUE = '__all__';

export interface OrdersToolbarProps {
  q: string;
  status: OrderStatusValue | null;
  reconciliationStatus: ReconciliationStatusValue | null;
  lossOnly: boolean;
  from: string;
  to: string;
  onChange: (next: {
    q?: string;
    status?: OrderStatusValue | null;
    reconciliationStatus?: ReconciliationStatusValue | null;
    lossOnly?: boolean;
    from?: string;
    to?: string;
  }) => void;
  className?: string;
}

/**
 * Filter row above the orders table. Search (debounce-free; orders list is
 * server-paginated and queries inexpensive), status select, reconciliation
 * status select, and a date range over orderDate. "Hepsi temizle" appears
 * when any filter is active.
 */
export function OrdersToolbar({
  q,
  status,
  reconciliationStatus,
  lossOnly,
  from,
  to,
  onChange,
  className,
}: OrdersToolbarProps): React.ReactElement {
  const t = useTranslations('ordersPage');
  const tCommon = useTranslations('common.dataTable.toolbar');

  const range: DateRange | undefined =
    from.length > 0 || to.length > 0
      ? {
          from: from.length > 0 ? new Date(from) : undefined,
          to: to.length > 0 ? new Date(to) : undefined,
        }
      : undefined;

  const handleRangeChange = (next: DateRange | undefined): void => {
    onChange({
      from: next?.from !== undefined ? toIsoDate(next.from) : '',
      to: next?.to !== undefined ? toIsoDate(next.to) : '',
    });
  };

  const hasAnyFilter =
    q.length > 0 ||
    status !== null ||
    reconciliationStatus !== null ||
    lossOnly ||
    from.length > 0 ||
    to.length > 0;

  return (
    <div className={cn('gap-sm flex flex-wrap items-center', className)}>
      <div className="max-w-input relative flex-1">
        <Search01Icon className="left-sm size-icon-sm text-muted-foreground pointer-events-none absolute top-1/2 -translate-y-1/2" />
        <Input
          value={q}
          onChange={(event) => onChange({ q: event.target.value })}
          placeholder={t('toolbar.searchPlaceholder')}
          className="pl-2xl"
        />
      </div>

      <Select
        value={status ?? ALL_VALUE}
        onValueChange={(value) =>
          onChange({ status: value === ALL_VALUE ? null : (value as OrderStatusValue) })
        }
      >
        <SelectTrigger className="w-44">
          <SelectValue placeholder={t('toolbar.statusPlaceholder')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_VALUE}>{t('toolbar.statusAll')}</SelectItem>
          {ORDER_STATUSES.map((value) => (
            <SelectItem key={value} value={value}>
              {t(`status.${value}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={reconciliationStatus ?? ALL_VALUE}
        onValueChange={(value) =>
          onChange({
            reconciliationStatus: value === ALL_VALUE ? null : (value as ReconciliationStatusValue),
          })
        }
      >
        <SelectTrigger className="w-56">
          <SelectValue placeholder={t('toolbar.reconciliationPlaceholder')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_VALUE}>{t('toolbar.reconciliationAll')}</SelectItem>
          {RECONCILIATION_STATUSES.map((value) => (
            <SelectItem key={value} value={value}>
              {t(`reconciliationStatus.${value}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <DateRangePicker value={range} onChange={handleRangeChange} />

      <Button
        type="button"
        variant={lossOnly ? 'default' : 'outline'}
        size="sm"
        aria-pressed={lossOnly}
        onClick={() => onChange({ lossOnly: !lossOnly })}
        className="gap-xs"
      >
        <Alert02Icon className="size-icon-sm" />
        {t('toolbar.lossOnly')}
      </Button>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          // Excel dışa aktarma backend'i henüz yok — yalnız yerleşim (no-op).
        }}
        className="gap-xs"
      >
        <DownloadSquare02Icon className="size-icon-sm" />
        {t('toolbar.exportExcel')}
      </Button>

      {hasAnyFilter ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            onChange({
              q: '',
              status: null,
              reconciliationStatus: null,
              lossOnly: false,
              from: '',
              to: '',
            })
          }
        >
          {tCommon('clear')}
          <Cancel01Icon className="ml-3xs size-icon-xs" />
        </Button>
      ) : null}
    </div>
  );
}

function toIsoDate(date: Date): string {
  // Use UTC components so the backend's `coerce.date()` lands on the intended
  // calendar day regardless of the user's tz (orders.orderDate is a UTC ts).
  const year = date.getUTCFullYear().toString();
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}
