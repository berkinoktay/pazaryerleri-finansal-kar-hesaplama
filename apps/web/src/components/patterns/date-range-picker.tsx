'use client';

import { Calendar01Icon } from 'hugeicons-react';
import * as React from 'react';
import type { DateRange } from 'react-day-picker';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface DateRangePickerProps {
  value?: DateRange;
  onChange?: (range: DateRange | undefined) => void;
  placeholder?: string;
  align?: 'start' | 'center' | 'end';
  className?: string;
}

/**
 * Canonical date range input for PazarSync. Used across profitability,
 * orders, reconciliation — any screen that scopes data to a period.
 *
 * Formats with tr-TR locale, uses the shared Calendar primitive for
 * selection, and renders the trigger as a text-mode button so it looks
 * like an input. Selecting a complete range auto-closes the popover.
 */
export function DateRangePicker({
  value,
  onChange,
  placeholder = 'Tarih aralığı seç',
  align = 'start',
  className,
}: DateRangePickerProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const label = formatRange(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="md"
          className={cn(
            'justify-start font-normal',
            !value?.from && 'text-muted-foreground',
            className,
          )}
        >
          <Calendar01Icon className="size-icon-sm" />
          {label ?? placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align={align}>
        <Calendar
          mode="range"
          numberOfMonths={2}
          defaultMonth={value?.from}
          selected={value}
          onSelect={(next) => {
            onChange?.(next);
            if (next?.from && next?.to) setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function formatRange(range: DateRange | undefined): string | null {
  if (!range?.from) return null;
  const fromLabel = format(range.from, 'd MMM yyyy', { locale: tr });
  if (!range.to) return fromLabel;
  const toLabel = format(range.to, 'd MMM yyyy', { locale: tr });
  return `${fromLabel} – ${toLabel}`;
}
