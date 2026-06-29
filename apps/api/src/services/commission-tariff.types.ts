// Internal domain types for the saved Commission Tariffs backend.
//
// The wire (request/response) contract lives in
// `validators/commission-tariff.validator.ts`; this file holds the types the
// service layer reasons with internally — the persisted band JSON shape and the
// period validity derivation.

import type { Prisma } from '@pazarsync/db';

// ─── Persisted band JSON ───────────────────────────────────────────────────
//
// Trendyol's tariff bands are PRICE RANGES, not single thresholds: each band is
// a [lowerLimit, upperLimit] window with its own commission. The seller drops
// the price into a lower window to earn a lower commission. Band 1 is the
// current tier (no upper limit — the seller's current price applies); band 4 has
// no lower limit. Money is kept as decimal STRINGS; `commissionPct` is a PERCENT
// (e.g. "19", "13.1"), exactly as the Excel states it.

export interface StoredBand {
  readonly key: string;
  readonly lowerLimit: string | null;
  readonly upperLimit: string | null;
  readonly commissionPct: string;
}

/**
 * Parses the persisted `bands` JSON into a typed array, dropping any entry that
 * does not match the expected shape. Returns `[]` for a non-array value. A limit
 * is `null` when its key is absent or not a string — the persisted JSON OMITS
 * null limits (band 1 has no upper, band 4 no lower) so the stored value never
 * carries an explicit JSON null. No type assertions: every field is runtime
 * checked, so malformed rows degrade to an empty band list rather than throwing.
 */
export function parseStoredBands(value: Prisma.JsonValue): StoredBand[] {
  if (!Array.isArray(value)) return [];

  const bands: StoredBand[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const { key, lowerLimit, upperLimit, commissionPct } = entry;
    if (typeof key === 'string' && typeof commissionPct === 'string') {
      bands.push({
        key,
        lowerLimit: typeof lowerLimit === 'string' ? lowerLimit : null,
        upperLimit: typeof upperLimit === 'string' ? upperLimit : null,
        commissionPct,
      });
    }
  }
  return bands;
}

// ─── Period validity ────────────────────────────────────────────────────────

export type TariffValidity = 'active' | 'upcoming' | 'past';

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

// ─── Trendyol period-label date parsing ─────────────────────────────────────
//
// Labels look like "26 Haziran 08.00-30 Haziran 07.59" (no year). Best-effort:
// parse both halves; null when unparseable so validity simply degrades to null.
// The İstanbul wall-clock time is stored as the instant verbatim — validity only
// needs coarse ordering, not exact timezone math.

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

/** Parses one "DD Ay HH.MM" half of a period label into an instant, or null. */
export function parsePeriodPart(part: string, year: number): Date | null {
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
  return new Date(Date.UTC(year, month, Number(dayRaw), Number(hourRaw), Number(minuteRaw)));
}

/**
 * Parses a "start-end" period label into instants. `referenceYear` supplies the
 * missing year; if the end falls before the start, it is rolled to the next year.
 * Returns `{ null, null }` when the label is not a two-part dated range.
 */
export function parseTariffPeriodLabel(
  label: string,
  referenceYear: number,
): { startsAt: Date | null; endsAt: Date | null } {
  const parts = label.split('-');
  if (parts.length !== 2) return { startsAt: null, endsAt: null };
  const startsAt = parsePeriodPart(parts[0] ?? '', referenceYear);
  let endsAt = parsePeriodPart(parts[1] ?? '', referenceYear);
  if (startsAt !== null && endsAt !== null && endsAt.getTime() < startsAt.getTime()) {
    endsAt = parsePeriodPart(parts[1] ?? '', referenceYear + 1);
  }
  return { startsAt, endsAt };
}
