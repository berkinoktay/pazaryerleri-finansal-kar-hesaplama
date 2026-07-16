'use client';

import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Calendar01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
 * Opt into a time-of-day picker with `withTime`: an `HH:mm` control
 * renders below the calendar, the trigger label gains the time, and the
 * popover stays open on day-select so the seller can confirm/adjust the
 * hour (closes via the "Done" affordance or an outside-click). When
 * `withTime` is omitted the component is byte-identical to the day-only
 * behavior.
 *
 * For range selection use `DateRangePicker`; for inline month grid
 * (no popover trigger) use the raw `Calendar` primitive.
 *
 * @useWhen accepting a single date (optionally with a time-of-day) as form input via a popover-anchored picker (use DateRangePicker for ranges, raw Calendar for inline grids)
 */

/** An hour/minute pair in the runtime local timezone — mirrors how the day is carried. */
export interface TimeOfDay {
  hours: number;
  minutes: number;
}

const MIDNIGHT: TimeOfDay = { hours: 0, minutes: 0 };

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Formats an {@link TimeOfDay} for the native `type="time"` control (`HH:mm`). */
function toTimeInputValue(time: TimeOfDay): string {
  return `${pad2(time.hours)}:${pad2(time.minutes)}`;
}

export interface DateInputProps {
  /** Controlled value. `null` represents an empty field. */
  value?: Date | null;
  /** Fires once on date selection (auto-closes the popover unless `withTime`). */
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
  /**
   * Opt-in: render an `HH:mm` time control below the calendar so the chosen
   * instant carries an hour/minute. Default `false` → day-only (unchanged).
   */
  withTime?: boolean;
  /**
   * Time applied when the user picks a day and the value had no explicit time
   * yet (i.e. the first selection). Only meaningful with `withTime`.
   */
  defaultTime?: TimeOfDay;
}

export function DateInput({
  value,
  onChange,
  placeholder,
  defaultMonth,
  disabled = false,
  align = 'start',
  className,
  withTime = false,
  defaultTime,
}: DateInputProps): React.ReactElement {
  const t = useTranslations('common.dateInput');
  const timeInputId = React.useId();
  const [open, setOpen] = React.useState(false);

  // The hour/minute to apply on the NEXT day-selection while no value carries one yet. Once a
  // value exists, its own H:M is authoritative (`effectiveTime` below), so this is only the
  // "pending" seed for the first pick. Initialized from an incoming value (edit path) or the
  // caller's defaultTime.
  const [pendingTime, setPendingTime] = React.useState<TimeOfDay>(() =>
    value != null
      ? { hours: value.getHours(), minutes: value.getMinutes() }
      : (defaultTime ?? MIDNIGHT),
  );

  const effectiveTime: TimeOfDay =
    value != null ? { hours: value.getHours(), minutes: value.getMinutes() } : pendingTime;

  const labelFormat = withTime ? 'd MMM yyyy HH:mm' : 'd MMM yyyy';
  const label = value ? format(value, labelFormat, { locale: tr }) : null;

  const handleSelect = (next: Date | undefined): void => {
    if (next === undefined) {
      onChange?.(null);
      return;
    }
    if (!withTime) {
      // Day-only path — unchanged: carry the calendar's local-midnight Date and close.
      onChange?.(next);
      setOpen(false);
      return;
    }
    // Carry the H:M into the picked day exactly as the day itself is carried (runtime local tz,
    // matching the day-only path's local-midnight Date). The form's `.toISOString()` then
    // serializes the full instant the same way it already serialized the day.
    const applied = new Date(next);
    applied.setHours(effectiveTime.hours, effectiveTime.minutes, 0, 0);
    onChange?.(applied);
    // Keep the popover open so the seller can confirm/adjust the time.
  };

  const handleTimeChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const raw = event.target.value; // "HH:mm" — empty when the native control is cleared.
    if (raw === '') return;
    const [hoursPart, minutesPart] = raw.split(':');
    const hours = Number(hoursPart);
    const minutes = Number(minutesPart);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return;
    setPendingTime({ hours, minutes });
    if (value != null) {
      const applied = new Date(value);
      applied.setHours(hours, minutes, 0, 0);
      onChange?.(applied);
    }
  };

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
          onSelect={handleSelect}
        />
        {withTime ? (
          <div className="border-border p-sm gap-sm flex items-end justify-between border-t">
            <div className="gap-3xs flex flex-col">
              <Label htmlFor={timeInputId} className="text-2xs text-muted-foreground">
                {t('timeLabel')}
              </Label>
              <Input
                id={timeInputId}
                type="time"
                size="sm"
                className="w-auto"
                value={toTimeInputValue(effectiveTime)}
                onChange={handleTimeChange}
              />
            </div>
            <Button type="button" size="sm" onClick={() => setOpen(false)}>
              {t('done')}
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
