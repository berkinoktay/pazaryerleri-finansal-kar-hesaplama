'use client';

import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Calendar01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  selectTriggerVariants,
} from '@/components/ui/select';
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
 * Opt into a time-of-day picker with `withTime`: two token-based hour
 * (00–23) and minute (00–59) `Select`s render below the calendar, the
 * trigger label gains the time, and the popover stays open on day-select
 * so the seller can confirm/adjust the hour (closes via the "Done"
 * affordance or an outside-click). When `withTime` is omitted the
 * component is byte-identical to the day-only behavior.
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

// Zero-padded option lists for the hour / minute Selects, built once. The value string doubles as
// the visible label (e.g. "08", "00"), so no per-item formatting is needed.
const HOUR_OPTIONS: readonly string[] = Array.from({ length: 24 }, (_, index) => pad2(index));
const MINUTE_OPTIONS: readonly string[] = Array.from({ length: 60 }, (_, index) => pad2(index));

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
  const timeLabelId = React.useId();
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

  // Shared H:M writer for both Selects: remembers the pending time (seed for the next day-pick) and,
  // when a value already exists, emits a fresh Date with the H:M applied — same setHours path the
  // day carries, so serialization + the tz round-trip are unchanged.
  const applyTime = (hours: number, minutes: number): void => {
    setPendingTime({ hours, minutes });
    if (value != null) {
      const applied = new Date(value);
      applied.setHours(hours, minutes, 0, 0);
      onChange?.(applied);
    }
  };

  const handleHoursChange = (next: string): void => applyTime(Number(next), effectiveTime.minutes);
  const handleMinutesChange = (next: string): void => applyTime(effectiveTime.hours, Number(next));

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
          <div className="border-border p-sm gap-sm flex flex-col border-t">
            <Label id={timeLabelId} className="text-2xs text-muted-foreground">
              {t('timeLabel')}
            </Label>
            <div className="gap-sm flex items-center justify-between">
              <div className="gap-2xs flex items-center">
                <Select value={pad2(effectiveTime.hours)} onValueChange={handleHoursChange}>
                  <SelectTrigger size="sm" className="w-20" aria-labelledby={timeLabelId}>
                    {pad2(effectiveTime.hours)}
                  </SelectTrigger>
                  {/* Cap the 24-row list so it scrolls in a bounded box instead of filling the
                      viewport (the primitive's available-height cap grows to full screen near the
                      top). max-h-72 matches the repo's other dropdown caps. */}
                  <SelectContent className="max-h-72">
                    {HOUR_OPTIONS.map((hour) => (
                      <SelectItem key={hour} value={hour}>
                        {hour}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span aria-hidden className="text-muted-foreground">
                  :
                </span>
                <Select value={pad2(effectiveTime.minutes)} onValueChange={handleMinutesChange}>
                  <SelectTrigger size="sm" className="w-20" aria-labelledby={timeLabelId}>
                    {pad2(effectiveTime.minutes)}
                  </SelectTrigger>
                  {/* Same bounded cap for the 60-row minute list. */}
                  <SelectContent className="max-h-72">
                    {MINUTE_OPTIONS.map((minute) => (
                      <SelectItem key={minute} value={minute}>
                        {minute}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" size="sm" onClick={() => setOpen(false)}>
                {t('done')}
              </Button>
            </div>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
