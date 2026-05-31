'use client';

import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Calendar01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { selectTriggerVariants } from '@/components/ui/select';
import { cn } from '@/lib/utils';

/**
 * Single-date input — complement to `DateRangePicker` for screens that
 * scope to a single day rather than a range. Same trigger geometry as
 * the range variant (outline button + leading calendar icon + tr-TR
 * formatted label) so paired controls on the same surface stay
 * visually consistent.
 *
 * Composes `Calendar` (mode="single", tr-TR locale) inside a
 * `Popover`. Selecting a date auto-closes the popover. The default
 * placeholder reads from `t('common.dateInput.placeholder')` — pass
 * the `placeholder` prop to override per-screen.
 *
 * For range selection use `DateRangePicker`; for inline month grid
 * (no popover trigger) use the raw `Calendar` primitive.
 *
 * @useWhen accepting a single date as form input via a popover-anchored picker (use DateRangePicker for ranges, raw Calendar for inline grids)
 */
export interface DateInputProps {
  /** Controlled value. `null` represents an empty field. */
  value?: Date | null;
  /** Fires once on date selection (auto-closes the popover). */
  onChange?: (next: Date | null) => void;
  /** Override the localized default ("Tarih seç" / "Pick a date"). */
  placeholder?: string;
  /** Initial calendar month when no value is set. Defaults to today. */
  defaultMonth?: Date;
  /** Disable the trigger entirely. */
  disabled?: boolean;
  /** Forwarded to PopoverContent. Defaults to start. */
  align?: 'start' | 'center' | 'end';
  className?: string;
}

export function DateInput({
  value,
  onChange,
  placeholder,
  defaultMonth,
  disabled = false,
  align = 'start',
  className,
}: DateInputProps): React.ReactElement {
  const t = useTranslations('common.dateInput');
  const [open, setOpen] = React.useState(false);
  const label = value ? format(value, 'd MMM yyyy', { locale: tr }) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          // Shares the SelectTrigger field recipe (bg-input, border-input, hover
          // border-strong, focus glow) so the date field matches sibling inputs
          // instead of reading as an outline button — fixes the bg-background vs
          // bg-input mismatch (most visible in dark mode, where bg-background sat
          // darker than the card while real fields sit lighter).
          // `inline-flex w-auto` overrides the recipe's `flex w-full` (meant for
          // form-column fields) so the picker hugs its label by default — matching
          // the previous outline-button behavior and inline / toolbar use. Pass
          // className="w-full" to fill a form column.
          className={cn(
            selectTriggerVariants({ size: 'md' }),
            'inline-flex w-auto',
            // a Date is always truthy → `!value` is true only when null/undefined.
            !value && 'text-muted-foreground',
            className,
          )}
        >
          <Calendar01Icon className="size-icon-sm text-muted-foreground shrink-0" />
          <span className="truncate">{label ?? placeholder ?? t('placeholder')}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align={align}>
        <Calendar
          mode="single"
          defaultMonth={value ?? defaultMonth}
          selected={value ?? undefined}
          onSelect={(next) => {
            onChange?.(next ?? null);
            if (next !== undefined) setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
