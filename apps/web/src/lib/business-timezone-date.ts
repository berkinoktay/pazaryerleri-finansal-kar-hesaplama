import { APP_TIME_ZONE, businessZoneEpochToInstant } from '@pazarsync/utils';

/**
 * Bridges the discount campaign form's date/time fields to the business timezone
 * ({@link APP_TIME_ZONE}, Europe/Istanbul) — the single source of truth for every
 * "business day"/"business hour" decision in the app.
 *
 * WHY this exists: the shared `<DateInput>` primitive speaks the BROWSER's LOCAL
 * wall clock — the `Date` it carries encodes local Y/M/D/H/M components, and the
 * form serializes it with `date.toISOString()`. So the resolved UTC instant depends
 * on where the browser sits: a seller on a non-Istanbul machine would pin a campaign
 * bound to the wrong instant, which can shift the tariff-week resolution to the wrong
 * week. These two helpers reinterpret the picker's LOCAL components AS Istanbul wall
 * clock (and back for display), so the campaign bound means the same instant no matter
 * the browser timezone. We bridge ONLY at the discount form's read/write boundary and
 * deliberately do NOT change `<DateInput>` itself (its other callers keep local-wall-
 * clock semantics).
 */

/**
 * Reinterpret a picker `Date`'s LOCAL Y/M/D/H/M components AS {@link APP_TIME_ZONE}
 * wall clock and return the true UTC instant's ISO string. Browser-timezone
 * independent: it reads the component parts, never the raw instant.
 */
export function localWallClockAsBusinessZoneIso(localWallClock: Date): string {
  return businessZoneEpochToInstant(
    Date.UTC(
      localWallClock.getFullYear(),
      localWallClock.getMonth(),
      localWallClock.getDate(),
      localWallClock.getHours(),
      localWallClock.getMinutes(),
      0,
      0,
    ),
  ).toISOString();
}

/**
 * Inverse of {@link localWallClockAsBusinessZoneIso} for display: format the UTC
 * instant `iso` into {@link APP_TIME_ZONE} Y/M/D/H/M parts, then build a LOCAL `Date`
 * from them so the picker's `getHours()`/`getDate()` surface the Istanbul values.
 */
export function businessZoneIsoToLocalWallClock(iso: string): Date {
  const parts = new Map(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: APP_TIME_ZONE,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  );
  const num = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.get(type) ?? '0');
  return new Date(num('year'), num('month') - 1, num('day'), num('hour'), num('minute'), 0, 0);
}
