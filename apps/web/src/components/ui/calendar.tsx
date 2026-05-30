'use client';

import { ArrowLeft01Icon, ArrowRight01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import {
  DayButton,
  DayPicker,
  useDayPicker,
  type CalendarMonth,
  type DayButtonProps,
} from 'react-day-picker';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

/**
 * Localized calendar built on react-day-picker. The date-fns locale is
 * hard-bound to Turkish (`tr`) per PRODUCT_VISION.md ("Turkish-only for
 * now") — month names + first-day-of-week + ordinal capitalization all
 * follow Turkish convention. The aria-labels for prev/next month read
 * from `t('common.calendar.*')` so screen readers announce the right
 * language regardless of the visible month label format.
 *
 * Layout override: react-day-picker v9's default layout renders Nav as a
 * sibling of the month column, so prev/next float at the top-left of the
 * months container instead of flanking each month's caption. We hide the
 * built-in Nav (`hideNavigation`) and render our own caption that
 * includes prev on the left, label in the middle, next on the right —
 * the "around the caption" layout users expect.
 *
 * Range-middle day cells reuse the primary radius tokens so a selected
 * range reads as a continuous pill with rounded caps.
 *
 * @useWhen rendering an inline month grid for date or date-range selection (use DateRangePicker pattern for the popover-anchored variant)
 */

function MonthCaption({ calendarMonth }: { calendarMonth: CalendarMonth }): React.ReactElement {
  const { goToMonth, previousMonth, nextMonth } = useDayPicker();
  const t = useTranslations('common.calendar');
  const label = format(calendarMonth.date, 'LLLL yyyy', { locale: tr });
  const capitalized = label.charAt(0).toLocaleUpperCase('tr') + label.slice(1);
  return (
    <div className="flex items-center justify-between">
      <button
        type="button"
        disabled={!previousMonth}
        onClick={() => previousMonth && goToMonth(previousMonth)}
        aria-label={t('previousMonth')}
        className={cn(buttonVariants({ variant: 'outline', size: 'icon-sm', radius: 'md' }))}
      >
        <ArrowLeft01Icon />
      </button>
      <span role="status" aria-live="polite" className="text-foreground text-sm font-semibold">
        {capitalized}
      </span>
      <button
        type="button"
        disabled={!nextMonth}
        onClick={() => nextMonth && goToMonth(nextMonth)}
        aria-label={t('nextMonth')}
        className={cn(buttonVariants({ variant: 'outline', size: 'icon-sm', radius: 'md' }))}
      >
        <ArrowRight01Icon />
      </button>
    </div>
  );
}

/**
 * Wraps react-day-picker's default `DayButton` (preserving its focus-management
 * ref/effect and class wiring) to render a small centered `--primary` dot under
 * the number for `today`. The dot is suppressed when the day is also selected —
 * the solid primary fill already marks the cell, and a contrasting dot on top
 * would read as noise. `aria-hidden` keeps it decorative; the `today` state is
 * still announced by react-day-picker's gridcell label.
 */
function CalendarDayButton(props: DayButtonProps): React.ReactElement {
  const { children, ...rest } = props;
  const showTodayDot = props.modifiers.today && !props.modifiers.selected;
  return (
    <DayButton {...rest}>
      {children}
      {showTodayDot ? (
        <span
          aria-hidden
          className="bg-primary absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full"
        />
      ) : null}
    </DayButton>
  );
}

export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  components,
  ...props
}: CalendarProps): React.ReactElement {
  return (
    <DayPicker
      locale={tr}
      showOutsideDays={showOutsideDays}
      hideNavigation
      className={cn('p-md', className)}
      classNames={{
        months: 'flex flex-col gap-md sm:flex-row sm:gap-lg',
        month: 'flex flex-col gap-sm',
        month_grid: 'w-full border-collapse',
        weekdays: 'flex mb-3xs',
        weekday:
          'text-muted-foreground w-calendar-cell text-2xs font-medium uppercase tracking-wide',
        week: 'flex w-full',
        // react-day-picker v9 puts state modifiers (`aria-selected`, `data-selected`) on the TD cell,
        // not the inner button — so all visual state (bg, radius, hover) lives here.
        day: cn(
          'relative size-calendar-cell p-0 text-center text-sm',
          'rounded-md transition-colors duration-fast ease-out-quart',
          'focus-within:relative focus-within:z-20',
          // hover only when NOT selected — keeps selected cells from flashing muted on hover
          '[&:not([aria-selected=true])]:hover:bg-muted',
        ),
        // Button stays transparent so the cell's background shows through; only focus + layout here.
        // Suppress the global :focus-visible glow — the explicit ring below is the focus affordance.
        day_button: cn(
          'relative inline-flex size-calendar-cell items-center justify-center rounded-md p-0 text-sm font-normal tabular-nums',
          'pointer-coarse:min-h-11',
          'bg-transparent',
          'transition-colors duration-fast ease-out-quart',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'focus:shadow-none focus-visible:shadow-none',
        ),
        // Selected single day or range endpoint — solid primary, hover stays primary.
        selected: cn(
          'aria-selected:bg-primary aria-selected:text-primary-foreground',
          'aria-selected:hover:bg-primary aria-selected:hover:text-primary-foreground',
        ),
        // `today` is NOT painted as text — a small primary dot renders under the number
        // (see DayButton) so today never reads as selected. No text/weight override here.
        today: '',
        outside: 'text-muted-foreground-dim',
        disabled: 'text-muted-foreground opacity-50',
        // Range endpoints keep primary fill; square off the inner side so the range reads continuous.
        range_start: 'aria-selected:rounded-r-none',
        range_end: 'aria-selected:rounded-l-none',
        // Range middle — soft primary surface, flat corners. Uses arbitrary `[&[aria-selected=true]]:`
        // selector so it emits LATER than `selected`'s plain `aria-selected:` rules at equal
        // specificity (0,2,0) — Tailwind v4 outputs arbitrary variants after standard ones,
        // so range_middle wins source-order on days that have both `selected` + `range_middle`.
        range_middle: cn(
          '[&[aria-selected=true]]:bg-primary-soft',
          '[&[aria-selected=true]]:text-primary-soft-foreground',
          '[&[aria-selected=true]]:rounded-none',
          '[&[aria-selected=true]]:hover:bg-primary-soft',
          '[&[aria-selected=true]]:hover:text-primary-soft-foreground',
        ),
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        MonthCaption,
        DayButton: CalendarDayButton,
        ...components,
      }}
      {...props}
    />
  );
}
