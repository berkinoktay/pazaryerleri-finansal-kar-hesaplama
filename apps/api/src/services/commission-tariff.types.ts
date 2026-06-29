// Internal domain types for the saved Commission Tariffs backend.
//
// The wire (request/response) contract lives in
// `validators/commission-tariff.validator.ts`; this file holds the types the
// service layer reasons with internally — the persisted band JSON shape and the
// period validity derivation.

import type { Prisma } from '@pazarsync/db';

// ─── Persisted band JSON ───────────────────────────────────────────────────
//
// Each CommissionTariffItem stores its price bands as a JSON array. Money values
// are kept as decimal STRINGS (never float) — `threshold` is the band's price
// (GROSS TRY) and `commissionPct` is a FRACTION (e.g. "0.19" = %19), straight
// from the uploaded Excel.

export interface StoredBand {
  readonly key: string;
  readonly threshold: string;
  readonly commissionPct: string;
}

/**
 * Parses the persisted `bands` JSON into a typed array, dropping any entry that
 * does not match the expected shape. Returns `[]` for a non-array value. No type
 * assertions — every field is runtime-checked so malformed rows degrade to an
 * empty band list rather than throwing.
 */
export function parseStoredBands(value: Prisma.JsonValue): StoredBand[] {
  if (!Array.isArray(value)) return [];

  const bands: StoredBand[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const { key, threshold, commissionPct } = entry;
    if (
      typeof key === 'string' &&
      typeof threshold === 'string' &&
      typeof commissionPct === 'string'
    ) {
      bands.push({ key, threshold, commissionPct });
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
