'use client';

import { Cancel01Icon, Search01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import type { DateRange } from 'react-day-picker';

import { DateRangePicker } from '@/components/patterns/date-range-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface ReturnsToolbarProps {
  q: string;
  from: string;
  to: string;
  onChange: (next: { q?: string; from?: string; to?: string }) => void;
  className?: string;
}

/**
 * Filter row above the returns table. Search (debounce-free; the claims list
 * is server-paginated and queries inexpensive) and a date range over
 * claimDate. "Hepsi temizle" appears when any filter is active. The status
 * dimension lives in the tab strip, not here.
 */
export function ReturnsToolbar({
  q,
  from,
  to,
  onChange,
  className,
}: ReturnsToolbarProps): React.ReactElement {
  const t = useTranslations('returnsPage');
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

  const hasAnyFilter = q.length > 0 || from.length > 0 || to.length > 0;

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

      <DateRangePicker value={range} onChange={handleRangeChange} />

      {hasAnyFilter ? (
        <Button variant="ghost" size="sm" onClick={() => onChange({ q: '', from: '', to: '' })}>
          {tCommon('clear')}
          <Cancel01Icon className="ml-3xs size-icon-xs" />
        </Button>
      ) : null}
    </div>
  );
}

function toIsoDate(date: Date): string {
  // Use UTC components so the backend's `coerce.date()` lands on the intended
  // calendar day regardless of the user's tz (claimDate is a UTC timestamp).
  // Mirrors orders-toolbar — promote to a shared util on the third copy.
  const year = date.getUTCFullYear().toString();
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}
