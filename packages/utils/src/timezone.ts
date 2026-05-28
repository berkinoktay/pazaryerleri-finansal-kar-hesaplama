/**
 * Returns midnight UTC representing today's date in Europe/Istanbul.
 * Used for "bugün" comparisons in Live Performance scope.
 *
 * Example (assume now = 2026-05-27T20:30:00Z, which is 23:30 in Istanbul):
 *   getTodayInIstanbul() → 2026-05-27T00:00:00.000Z
 *
 * Example (assume now = 2026-05-27T22:30:00Z, which is 01:30 next day in Istanbul):
 *   getTodayInIstanbul() → 2026-05-28T00:00:00.000Z
 */
export function getTodayInIstanbul(): Date {
  return startOfDayInIstanbul(new Date());
}

/**
 * Returns midnight UTC representing the calendar date of the input in Europe/Istanbul.
 * `Intl.DateTimeFormat` with the `en-CA` locale yields YYYY-MM-DD for the target
 * timezone, which we then anchor to UTC midnight for safe day-boundary comparison.
 * No date library — Intl is sufficient and dependency-free.
 */
export function startOfDayInIstanbul(date: Date): Date {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const ymd = formatter.format(date); // "2026-05-27"
  return new Date(`${ymd}T00:00:00.000Z`);
}
