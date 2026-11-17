// Shared period-label parsing + validity derivation for the campaign tariff
// features (Ürün Komisyon Tarifeleri + Plus Komisyon Tarifeleri, and any future
// Trendyol-Excel-driven campaign page whose rows carry a "Tarih Aralığı" range).
//
// Trendyol period labels look like "26 Haziran 08.00-30 Haziran 07.59" (no year).
// Best-effort: parse both halves; null when unparseable so validity simply
// degrades to null. The İstanbul wall-clock time is stored as the instant
// verbatim — validity only needs coarse ordering, not exact timezone math.

// The week of a tariff upload lives here too: the period blocks filled on the first
// data row (resolveTariffWeek), the week they span, the window labels its export can
// write (requireWritableWindows), and the query for a tariff of the same store whose
// week overlaps it (findOverlappingWeek).

import { DEFAULT_ROW_CAP, SpreadsheetFileError } from '@pazarsync/spreadsheet';
import { mapPrismaError } from '@pazarsync/sync-core';
import {
  getBusinessDateAnchor,
  TARIFF_WEEK_DAYS,
  tariffBoundToInstant,
  tariffWeekDays,
} from '@pazarsync/utils';

import type { StoreScope } from './adapter';
import type { WriteValueSpec } from './format';
import { WorkbookFileRejection } from './workbook-errors';
import { requireWritableValue } from './write-columns';

export type TariffValidity = 'active' | 'upcoming' | 'past';

/**
 * Null-safe {@link tariffBoundToInstant}: converts a stored tariff bound (Istanbul
 * wall-clock saved as UTC) to the real instant it denotes, passing `null` straight
 * through. Tariff-period/week callers compare these bounds against a true-instant
 * `now`, so the bounds must be reconciled to the same frame first; the bound may be
 * null (an unparseable period label) and `resolveValidity` keeps that null contract,
 * so the conversion preserves it. Routes through the one business-timezone helper.
 */
export function tariffBoundInstantOrNull(bound: Date | null): Date | null {
  return bound === null ? null : tariffBoundToInstant(bound);
}

/**
 * Derives a period's validity from its best-effort parsed bounds versus `now`.
 * Returns `null` when neither bound is known (label was unparseable) so the UI
 * simply omits the validity badge. `now` is an instant — passed in for
 * testability; the caller supplies the current time.
 */
export function resolveValidity(
  startsAt: Date | null,
  endsAt: Date | null,
  now: Date,
): TariffValidity | null {
  if (startsAt === null && endsAt === null) return null;
  if (endsAt !== null && now.getTime() > endsAt.getTime()) return 'past';
  if (startsAt !== null && now.getTime() < startsAt.getTime()) return 'upcoming';
  return 'active';
}

const TR_MONTHS: Readonly<Record<string, number>> = {
  ocak: 0,
  şubat: 1,
  mart: 2,
  nisan: 3,
  mayıs: 4,
  haziran: 5,
  temmuz: 6,
  ağustos: 7,
  eylül: 8,
  ekim: 9,
  kasım: 10,
  aralık: 11,
};

const PERIOD_PART_RE = /(\d{1,2})\s+(\p{L}+)\s+(\d{1,2})[.:](\d{2})/u;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The year offsets a label's date is tried at around its reference: a year back, the same, a year on. */
const CANDIDATE_YEAR_OFFSETS = [-1, 0, 1] as const;

/** One "DD Ay HH.MM" half of a period label, without a year (the labels carry none). */
interface PeriodPart {
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

function readPeriodPart(part: string): PeriodPart | null {
  const match = PERIOD_PART_RE.exec(part.trim());
  if (match === null) return null;
  const [, dayRaw, monthRaw, hourRaw, minuteRaw] = match;
  if (
    dayRaw === undefined ||
    monthRaw === undefined ||
    hourRaw === undefined ||
    minuteRaw === undefined
  ) {
    return null;
  }
  const month = TR_MONTHS[monthRaw.toLocaleLowerCase('tr')];
  if (month === undefined) return null;
  return { month, day: Number(dayRaw), hour: Number(hourRaw), minute: Number(minuteRaw) };
}

/** The part in `year`, or null for a day the month does not have that year (29 Şubat). */
function periodPartIn(part: PeriodPart, year: number): Date | null {
  const date = new Date(Date.UTC(year, part.month, part.day, part.hour, part.minute));
  return date.getUTCMonth() === part.month ? date : null;
}

/** The part in whichever year around `reference` puts it closest to `reference`. */
function periodPartClosestTo(part: PeriodPart, reference: Date): Date | null {
  const referenceYear = reference.getUTCFullYear();
  let closest: Date | null = null;
  for (const offset of CANDIDATE_YEAR_OFFSETS) {
    const candidate = periodPartIn(part, referenceYear + offset);
    if (candidate === null) continue;
    const distance = Math.abs(candidate.getTime() - reference.getTime());
    if (closest === null || distance < Math.abs(closest.getTime() - reference.getTime())) {
      closest = candidate;
    }
  }
  return closest;
}

/**
 * Parses a "start-end" period label into instants. The label carries no year: the
 * start takes the year that puts it closest to `reference` (a year back, the same or a
 * year on), and the end the start's year, rolled to the next one when it would fall
 * before the start. Returns `{ null, null }` when the label is not a two-part dated
 * range. `reference` is in the stored frame (Istanbul wall-clock saved as UTC).
 */
export function parseTariffPeriodLabel(
  label: string,
  reference: Date,
): { startsAt: Date | null; endsAt: Date | null } {
  const parts = label.split('-');
  if (parts.length !== 2) return { startsAt: null, endsAt: null };
  const startPart = readPeriodPart(parts[0] ?? '');
  const endPart = readPeriodPart(parts[1] ?? '');
  const startsAt = startPart === null ? null : periodPartClosestTo(startPart, reference);
  if (endPart === null) return { startsAt, endsAt: null };
  if (startsAt === null) return { startsAt, endsAt: periodPartClosestTo(endPart, reference) };
  const startYear = startsAt.getUTCFullYear();
  const sameYearEnd = periodPartIn(endPart, startYear);
  const endsAt =
    sameYearEnd !== null && sameYearEnd.getTime() >= startsAt.getTime()
      ? sameYearEnd
      : periodPartIn(endPart, startYear + 1);
  return { startsAt, endsAt };
}

/** One period block of an upload whose date-range label is filled on the first data row. */
export interface PresentPeriod {
  /** The date-range label as the file holds it. */
  readonly label: string;
  /** The block's day count, the N of its "(N Gun)" header. */
  readonly dayCount: number;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  /** The period's position among the present periods. */
  readonly sortOrder: number;
  /** The block's position among the layout's blocks: where a row holds this period's cells. */
  readonly layoutIndex: number;
}

/** The periods an upload stores and the week they span (earliest start, latest end). */
export interface TariffWeek {
  readonly present: readonly PresentPeriod[];
  readonly weekStartsAt: Date | null;
  readonly weekEndsAt: Date | null;
}

/** The week column of the one-tariff-per-week unique index (`@@unique([storeId, weekStartsAt])`). */
export const WEEK_UNIQUE_COLUMN = 'week_starts_at';

function knownTimes(dates: readonly (Date | null)[]): number[] {
  return dates.filter((date): date is Date => date !== null).map((date) => date.getTime());
}

/** The earliest of the known dates; null when none is known. */
function earliest(dates: readonly (Date | null)[]): Date | null {
  const times = knownTimes(dates);
  return times.length === 0 ? null : new Date(Math.min(...times));
}

/** The latest of the known dates; null when none is known. */
function latest(dates: readonly (Date | null)[]): Date | null {
  const times = knownTimes(dates);
  return times.length === 0 ? null : new Date(Math.max(...times));
}

/**
 * The periods whose label is filled on the first data row, in block order, each with
 * its best-effort parsed bounds, and the week they span: the earliest parsed start and
 * the latest parsed end, each null when no label parsed. A block whose label is blank
 * on the first row carries no data and is left out.
 *
 * The labels carry no year. The first label that parses takes the year that puts it
 * closest to the upload day in Istanbul (`now`'s business date), and every later label
 * the year that puts it closest to that first label's start (its end, when only the end
 * parses): the periods of one week lie within days of each other, so a week that
 * crosses New Year gets its two years whether it is uploaded in December or in January.
 * A week up to about six months before or after the upload day is placed in its own
 * year.
 *
 * Throws WorkbookFileRejection NO_PERIOD when no label is filled.
 */
export function resolveTariffWeek(
  firstRowPeriods: readonly { readonly tag: number; readonly label: string | null }[],
  now: Date,
): TariffWeek {
  const uploadDay = getBusinessDateAnchor(now);
  let weekAnchor: Date | null = null;
  const present: PresentPeriod[] = [];
  firstRowPeriods.forEach((period, layoutIndex) => {
    if (period.label === null) return;
    const { startsAt, endsAt } = parseTariffPeriodLabel(period.label, weekAnchor ?? uploadDay);
    weekAnchor ??= startsAt ?? endsAt;
    present.push({
      label: period.label,
      dayCount: period.tag,
      startsAt,
      endsAt,
      sortOrder: present.length,
      layoutIndex,
    });
  });
  if (present.length === 0) throw new WorkbookFileRejection('NO_PERIOD');
  return {
    present,
    weekStartsAt: earliest(present.map((period) => period.startsAt)),
    weekEndsAt: latest(present.map((period) => period.endsAt)),
  };
}

/**
 * The week query of a tariff table: both tariff tables expose it, through the client
 * and through a transaction alike.
 */
export interface TariffWeekTable {
  findFirst(args: {
    where: {
      organizationId: string;
      storeId: string;
      weekStartsAt: { lt: Date };
      weekEndsAt: { gt: Date };
    };
    select: { id: true };
  }): PromiseLike<{ id: string } | null>;
}

/**
 * A tariff of the scope's store whose week overlaps `week`, or null. Two weeks overlap
 * when each starts before the other ends, so back-to-back weeks, which touch at a
 * one-minute gap (07.59, then 08.00), do not. Nothing is asked, and null is returned,
 * when a bound of `week` is unknown (an unparsed label). An import asks before its
 * transaction, then again inside it, where the per-store-and-page import lock makes a
 * concurrent upload's committed tariff visible.
 */
export async function findOverlappingWeek(
  table: TariffWeekTable,
  scope: StoreScope,
  week: Pick<TariffWeek, 'weekStartsAt' | 'weekEndsAt'>,
): Promise<{ readonly id: string } | null> {
  const { weekStartsAt, weekEndsAt } = week;
  if (weekStartsAt === null || weekEndsAt === null) return null;
  return table.findFirst({
    where: {
      organizationId: scope.organizationId,
      storeId: scope.storeId,
      weekStartsAt: { lt: weekEndsAt },
      weekEndsAt: { gt: weekStartsAt },
    },
    select: { id: true },
  });
}

/** `meta.reason` of the MALFORMED_SHEET `requireTariffPeriods` throws for the period blocks. */
export const TARIFF_PERIODS_REASON = 'tariff-periods';

/** `meta.reason` of the MALFORMED_SHEET `requireTariffPeriods` throws for the parsed dates. */
export const TARIFF_WEEK_SPAN_REASON = 'tariff-week-span';

/** A period block covers at least one day. */
const MIN_PERIOD_DAYS = 1;

/**
 * The most periods `requireTariffPeriods` lets one week hold. Their day counts are
 * distinct and at least MIN_PERIOD_DAYS each, so N periods take at least
 * MIN_PERIOD_DAYS + (MIN_PERIOD_DAYS + 1) + ... days, N terms; this is the largest N
 * whose least days still fit in TARIFF_WEEK_DAYS.
 */
export const MAX_TARIFF_PERIODS = mostDistinctPeriods(TARIFF_WEEK_DAYS);

/**
 * The most items one tariff stores: each period holds one item per kept row of the
 * upload, and the import reads every upload with the engine's default row cap, so it
 * refuses a sheet of more than DEFAULT_ROW_CAP rows. A read with its own `rowCap` must
 * size this from that cap instead. Both tariff pages' selection routes accept this
 * many, so one save carries every item of the largest tariff; their single UPDATE binds
 * three values per item, and the selection route tests save this many to prove Postgres
 * takes it.
 */
export const MAX_TARIFF_ITEMS = DEFAULT_ROW_CAP * MAX_TARIFF_PERIODS;

function mostDistinctPeriods(weekDays: number): number {
  let periods = 0;
  let leastDays = 0;
  while (leastDays + MIN_PERIOD_DAYS + periods <= weekDays) {
    leastDays += MIN_PERIOD_DAYS + periods;
    periods += 1;
  }
  return periods;
}

function hasRepeats(values: readonly (number | string)[]): boolean {
  return new Set(values).size !== values.length;
}

/**
 * Checks the present periods of `week` as one Trendyol week holds them:
 * - each period covers at least one day, and their day counts add up to at most
 *   TARIFF_WEEK_DAYS: a "(0 Gun)" header adds 0 days, so without the first rule a file
 *   could carry any number of empty period blocks, each a stored period and an export
 *   window;
 * - no two periods share a day count or a date-range label: the export names a window
 *   by its day count, and two periods of one day count cannot both be written back;
 * - the parsed dates span at most TARIFF_WEEK_DAYS days, from the earliest start to the
 *   latest end, when both are known.
 *
 * Throws SpreadsheetFileError MALFORMED_SHEET, a 422 on `file` at upload: reason
 * TARIFF_PERIODS_REASON for the period blocks, TARIFF_WEEK_SPAN_REASON for the dates.
 * No value of the file appears in the message.
 */
export function requireTariffPeriods(
  week: Pick<TariffWeek, 'present' | 'weekStartsAt' | 'weekEndsAt'>,
): void {
  const dayCounts = week.present.map((period) => period.dayCount);
  const empty = dayCounts.some((days) => days < MIN_PERIOD_DAYS);
  const overfull = dayCounts.reduce((sum, days) => sum + days, 0) > TARIFF_WEEK_DAYS;
  const repeated = hasRepeats(dayCounts) || hasRepeats(week.present.map((period) => period.label));
  if (empty || overfull || repeated) {
    throw new SpreadsheetFileError(
      'MALFORMED_SHEET',
      'The tariff periods do not fit a week: a period of no days, more days than a week, or a repeated period',
      { reason: TARIFF_PERIODS_REASON },
    );
  }
  const { weekStartsAt, weekEndsAt } = week;
  if (weekStartsAt === null || weekEndsAt === null) return;
  if (weekEndsAt.getTime() - weekStartsAt.getTime() <= TARIFF_WEEK_DAYS * DAY_MS) return;
  throw new SpreadsheetFileError(
    'MALFORMED_SHEET',
    'The tariff period dates span more than a week',
    { reason: TARIFF_WEEK_SPAN_REASON },
  );
}

/**
 * Checks every window label the export of `week` can write against the tariff
 * selection column's rule: one per stored period, and the whole week's, whose length
 * is `tariffWeekDays` of the stored day counts (the day count `planWindowFiles` gives
 * the whole-week file). The day counts come from the file's headers, so a window the
 * export could not write is refused at upload.
 *
 * Throws SpreadsheetFileError MALFORMED_SHEET (reason UNWRITABLE_VALUE_REASON) for a
 * window label `write.spec` refuses, such as one wider than the column's probe.
 */
export function requireWritableWindows(
  week: TariffWeek,
  write: { readonly spec: WriteValueSpec; readonly label: (dayCount: number) => string },
): void {
  const dayCounts = week.present.map((period) => period.dayCount);
  for (const days of [...dayCounts, tariffWeekDays(dayCounts)]) {
    requireWritableValue(write.spec, write.label(days));
  }
}

/** The period blocks of a tariff's first data row: each block's day count and its label. */
export type FirstRowPeriods = readonly { readonly tag: number; readonly label: string | null }[];

/**
 * The week of a tariff upload, for both tariff pages' `inspect`: the periods filled on
 * the first data row (`resolveTariffWeek`), their day counts (`requireTariffPeriods`)
 * and the window labels the export writes (`requireWritableWindows`) checked, then the
 * scoped overlap query on `table`.
 *
 * Throws WorkbookFileRejection NO_PERIOD when no period label is filled,
 * SpreadsheetFileError MALFORMED_SHEET when the periods do not fit one week
 * (`requireTariffPeriods`) or a window label could not be written, and
 * WorkbookFileRejection DUPLICATE_WEEK when a tariff of the store already covers part of
 * the week.
 */
export async function inspectUploadWeek(input: {
  readonly table: TariffWeekTable;
  readonly scope: StoreScope;
  readonly firstRowPeriods: FirstRowPeriods;
  readonly now: Date;
  readonly write: { readonly spec: WriteValueSpec; readonly label: (dayCount: number) => string };
}): Promise<TariffWeek> {
  const week = resolveTariffWeek(input.firstRowPeriods, input.now);
  requireTariffPeriods(week);
  requireWritableWindows(week, input.write);
  let overlapping;
  try {
    overlapping = await findOverlappingWeek(input.table, input.scope, week);
  } catch (err) {
    mapPrismaError(err);
  }
  if (overlapping !== null) throw new WorkbookFileRejection('DUPLICATE_WEEK');
  return week;
}

/**
 * The overlap check of both tariff pages' `persist`, inside the import transaction.
 * The unique index only refuses an equal week start; inside the per-store-and-page
 * import lock a concurrent upload's committed tariff is visible, so an overlap with
 * another start is caught here. Throws WorkbookFileRejection DUPLICATE_WEEK.
 */
export async function assertNoOverlappingWeek(
  table: TariffWeekTable,
  scope: StoreScope,
  week: Pick<TariffWeek, 'weekStartsAt' | 'weekEndsAt'>,
): Promise<void> {
  if ((await findOverlappingWeek(table, scope, week)) !== null) {
    throw new WorkbookFileRejection('DUPLICATE_WEEK');
  }
}
