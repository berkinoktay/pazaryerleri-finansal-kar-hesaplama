// Window planning for multi-period tariff exports, shared by the api export and the
// web export preview so both always agree on which key lands in which file.
//
// A tariff can carry several date-range sub-periods (e.g. a 3-day + a 4-day split
// week), and the seller re-uploads per window. Picked keys are bucketed into:
//   - one file per sub-period, for keys whose value is period-specific;
//   - one whole-week file, for keys picked with the identical value in EVERY
//     sub-period.
// A single-period tariff yields one file. The function holds no marketplace wording:
// it returns numeric day counts, and the caller turns them into labels and suffixes.

/** A tariff week in days: the whole-week tag when the sub-periods' day counts sum to 0. */
export const TARIFF_WEEK_DAYS = 7;

/** One sub-period's picks. */
export interface WindowPeriodInput<K extends string = string> {
  /** N from the "(N Gun)" header; null only on legacy rows. */
  readonly dayCount: number | null;
  /**
   * Picked keys only, mapped to the value that is both written and compared (a
   * `toFixed(2)` price string); comparison is plain string equality.
   */
  readonly picks: ReadonlyMap<K, string>;
}

/** One output file. */
export interface WindowFilePlan<K extends string = string> {
  /** The resolved window tag, never null. */
  readonly dayCount: number;
  /** Input indices this file covers: `[i]` for a period file, every index for the week file. */
  readonly periodIndices: readonly number[];
  readonly picks: ReadonlyMap<K, string>;
}

/**
 * The length in days of a tariff week whose sub-periods have `dayCounts`: their sum, a
 * null count adding 0, or TARIFF_WEEK_DAYS when that sum is 0. It is the day count of
 * the whole-week file `planWindowFiles` writes.
 */
export function tariffWeekDays(dayCounts: readonly (number | null)[]): number {
  return dayCounts.reduce<number>((sum, days) => sum + (days ?? 0), 0) || TARIFF_WEEK_DAYS;
}

/**
 * Buckets per-sub-period picks into window files, each emitted only when it has a key.
 *
 * - The week length is the sum of the `dayCount`s (null counts as 0), or the fallback
 *   when that sum is 0. A period whose own `dayCount` is null is tagged with the week
 *   length.
 * - A single period yields one file, or `[]` when it has no picks.
 * - With several periods, a key goes into the week file only when it is picked in
 *   every period with an identical value; otherwise it goes into the file of each
 *   period that picks it. Keys follow period 0's order, then the new keys of later
 *   periods.
 * - Period files come first, in input order, then the week file.
 */
export function planWindowFiles<K extends string>(
  periods: readonly WindowPeriodInput<K>[],
): WindowFilePlan<K>[] {
  if (periods.length === 0) return [];
  const weekDays = tariffWeekDays(periods.map((p) => p.dayCount));

  if (periods.length === 1) {
    const only = periods[0];
    if (only === undefined || only.picks.size === 0) return [];
    return [
      { dayCount: only.dayCount ?? weekDays, periodIndices: [0], picks: new Map(only.picks) },
    ];
  }

  const week = new Map<K, string>();
  const perPeriod = periods.map(() => new Map<K, string>());

  const keys = new Set<K>();
  for (const period of periods) for (const key of period.picks.keys()) keys.add(key);

  for (const key of keys) {
    const values = periods.map((p) => p.picks.get(key) ?? null);
    const first = values[0];
    if (first !== undefined && first !== null && values.every((v) => v === first)) {
      week.set(key, first);
      continue;
    }
    values.forEach((value, i) => {
      if (value !== null) perPeriod[i]?.set(key, value);
    });
  }

  const files: WindowFilePlan<K>[] = [];
  periods.forEach((period, i) => {
    const picks = perPeriod[i];
    if (picks === undefined || picks.size === 0) return;
    files.push({ dayCount: period.dayCount ?? weekDays, periodIndices: [i], picks });
  });
  if (week.size > 0) {
    files.push({ dayCount: weekDays, periodIndices: periods.map((_, i) => i), picks: week });
  }
  return files;
}
