// Shared period-label parsing + validity derivation for the campaign tariff
// features (Ürün Komisyon Tarifeleri + Plus Komisyon Tarifeleri, and any future
// Trendyol-Excel-driven campaign page whose rows carry a "Tarih Aralığı" range).
//
// Trendyol period labels look like "26 Haziran 08.00-30 Haziran 07.59" (no year).
// Best-effort: parse both halves; null when unparseable so validity simply
// degrades to null. The İstanbul wall-clock time is stored as the instant
// verbatim — validity only needs coarse ordering, not exact timezone math.

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
