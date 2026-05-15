/**
 * Trendyol's seller panel maps internal segment override keys to "Seviye"
 * tier labels. Source of truth: the Trendyol commission tariff page in
 * the seller panel (Seviye 3 / 4 / 5 KDV Dahil Komisyon Oranı + Özelleşmiş
 * Grup KDV Dahil Komisyon Oranı). The base rate ("KDV Dahil Komisyon
 * Oranı" without a Seviye prefix) is rendered separately as the row's
 * baseRate column — not part of segmentOverrides.
 *
 * No `ka3` — Trendyol's panel only exposes Seviye 3/4/5 plus Özelleşmiş
 * Grup. If Trendyol ever adds more tiers, extend this map.
 */
export const SEGMENT_LABELS: Record<string, string> = {
  ka1: 'Seviye 5',
  ka2: 'Seviye 4',
  na1: 'Seviye 3',
  microSegment: 'Özelleşmiş Grup',
};

/**
 * Stable display order: highest tier first, special group last. The
 * tooltip walks this array and renders only the keys present in the
 * row's segmentOverrides map.
 */
export const SEGMENT_LABEL_ORDER = ['ka1', 'ka2', 'na1', 'microSegment'] as const;

export function getSegmentLabel(key: string): string {
  return SEGMENT_LABELS[key] ?? key;
}

export interface OrderedSegmentEntry {
  key: string;
  label: string;
  value: string;
}

/**
 * Project a segmentOverrides map into ordered display entries. Known keys
 * (per SEGMENT_LABEL_ORDER) come first in tier order; unknown keys append
 * afterwards in their input order so future Trendyol additions are still
 * visible even before the lib is updated.
 */
export function orderedSegmentEntries(overrides: Record<string, string>): OrderedSegmentEntry[] {
  const result: OrderedSegmentEntry[] = [];
  const seen = new Set<string>();

  for (const key of SEGMENT_LABEL_ORDER) {
    const value = overrides[key];
    if (value !== undefined) {
      result.push({ key, label: SEGMENT_LABELS[key] ?? key, value });
      seen.add(key);
    }
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!seen.has(key)) {
      result.push({ key, label: getSegmentLabel(key), value });
    }
  }
  return result;
}
