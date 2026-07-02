/**
 * Application business timezone — the single source of truth for every
 * "business day" computation in the app: the Live Performance daily reset,
 * "today"/"yesterday" filters, and day-bucketing of orders.
 *
 * Centralised here so the IANA zone identifier appears in exactly ONE place; the
 * rest of the codebase speaks in terms of the *business day* via the helpers
 * below, never a city name or a fixed UTC offset. The value is the IANA id for
 * Turkey time (currently UTC+3, no DST) because the sellers and the marketplaces
 * PazarSync integrates operate on that wall clock. If the product ever needs
 * per-tenant or multi-region time, lift this to config/DB — every caller already
 * routes through the helpers, so the change stays local to this module.
 *
 * The frontend's display timezone (`apps/web/src/i18n/config.ts`) re-exports this
 * constant, so UI formatting and backend business-day logic can never drift.
 */
export const APP_TIME_ZONE = 'Europe/Istanbul';

/**
 * Offset (local − UTC) in milliseconds for {@link APP_TIME_ZONE} at the instant
 * `at`. DST-aware: derived from the zone's own rules via `Intl`, never a
 * hard-coded number — so a future zone change (or a DST-observing zone) stays
 * correct without touching call sites.
 */
function appTimeZoneOffsetMs(at: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = new Map(formatter.formatToParts(at).map((part) => [part.type, part.value]));
  const num = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.get(type) ?? '0');
  const asUtc = Date.UTC(
    num('year'),
    num('month') - 1,
    num('day'),
    num('hour'),
    num('minute'),
    num('second'),
  );
  return asUtc - at.getTime();
}

/**
 * Reinterpret an epoch that encodes an {@link APP_TIME_ZONE} wall-clock as if it
 * were UTC, returning the true instant. Some marketplace feeds stamp local time
 * this way: Trendyol documents its order `orderDate` as "GMT +3" (an Istanbul
 * wall-clock value), so a raw `new Date(orderDate)` reads ~3h ahead of reality —
 * which throws off every business-day / business-hour calculation downstream.
 * This subtracts the zone's offset at that wall-clock to recover the real instant
 * so the math lines up with what the seller actually sees in the marketplace
 * panel. (Only use it for feeds known to send local-as-UTC; true-UTC fields like
 * Trendyol's `createdDate` must NOT be passed through it.)
 */
export function businessZoneEpochToInstant(epochMs: number): Date {
  return new Date(epochMs - appTimeZoneOffsetMs(new Date(epochMs)));
}

/**
 * The business calendar date of `at` as a `YYYY-MM-DD` string. `YYYY-MM-DD`
 * strings sort chronologically, so `getBusinessDate(a) < getBusinessDate(b)` is a
 * valid "earlier business day" test (used by the webhook late-arrival gate).
 */
export function getBusinessDate(at: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(at); // 'en-CA' yields ISO 'YYYY-MM-DD'
}

/**
 * The business date of `at` as a UTC-midnight-anchored `Date` whose UTC calendar
 * date equals the business date. Use for `@db.Date` columns (the buffer's
 * `orderDate`) and whole-day equality / `< today` comparisons — NOT as a real
 * instant. (A `@db.Date` column only stores the date part, so the UTC-midnight
 * anchor and the value round-trip identically.)
 */
export function getBusinessDateAnchor(at: Date = new Date()): Date {
  return new Date(`${getBusinessDate(at)}T00:00:00.000Z`);
}

/** The real UTC instant at which the business day containing `at` begins. */
function startOfBusinessDayUtc(at: Date): Date {
  const localMidnightAsUtc = new Date(`${getBusinessDate(at)}T00:00:00.000Z`);
  return new Date(localMidnightAsUtc.getTime() - appTimeZoneOffsetMs(localMidnightAsUtc));
}

/**
 * The half-open UTC instant window `[start, end)` covering the business day that
 * contains `at`. Use to filter full-timestamp columns (e.g. `orders.orderDate`)
 * into "today"/"yesterday": `where: { orderDate: { gte: start, lt: end } }`.
 *
 * DST-safe: `end` is re-derived from the next business midnight (a ~26h step then
 * re-floor) rather than `start + 24h`, so it stays correct across any future DST
 * transition even though the current zone has none.
 */
export function getBusinessDayRange(at: Date = new Date()): { start: Date; end: Date } {
  const start = startOfBusinessDayUtc(at);
  const end = startOfBusinessDayUtc(new Date(start.getTime() + 26 * 60 * 60 * 1000));
  return { start, end };
}

/** The business-timezone hour (0–23) of `at`, for hourly day-bucketing. */
export function getBusinessHour(at: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    hourCycle: 'h23',
    hour: '2-digit',
  });
  const hour = formatter.formatToParts(at).find((part) => part.type === 'hour')?.value ?? '0';
  return Number(hour);
}

/**
 * The UTC calendar day of `date` as `YYYY-MM-DD`. For date-range query params
 * whose backend counterpart is a UTC timestamp coerced with `coerce.date()` —
 * local wall-clock components would shift the day for evening picks in
 * UTC+3. Promoted from the orders/returns toolbars (third-copy rule).
 */
export function toUtcIsoDate(date: Date): string {
  const year = date.getUTCFullYear().toString();
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}
