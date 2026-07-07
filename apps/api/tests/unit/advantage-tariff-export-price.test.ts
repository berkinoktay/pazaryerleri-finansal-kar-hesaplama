import { Prisma } from '@pazarsync/db';
import { describe, expect, it } from 'vitest';

import { resolveAdvantageExportPrice } from '@/services/advantage-tariff-export.service';

// Regression guard for the "custom price never reaches the exported Excel" bug.
//
// A confirmed custom price is persisted with `selected_tier = NULL` (only
// `custom_price` set) because tier and custom are mutually exclusive in the UI. The
// old export loop gated on `selectedTier === null → skip`, so every custom-only row
// was dropped from the patched file. `resolveAdvantageExportPrice` checks the custom
// price FIRST, so a custom-only row now resolves to its price.

const TIERS: Prisma.JsonValue = [
  { key: 'tier1', upperLimit: '292.91', lowerLimit: '274.43' },
  { key: 'tier2', upperLimit: '274.42', lowerLimit: '223.79' },
  { key: 'tier3', upperLimit: '223.78' },
];

describe('resolveAdvantageExportPrice', () => {
  it('resolves a CUSTOM-ONLY row (selectedTier=null, customPrice set) to its custom price — the bug', () => {
    // This is the exact shape a "Kaydet ve indir" custom selection persists. Before the
    // fix the export skipped it (selectedTier === null) and the price never wrote back.
    expect(
      resolveAdvantageExportPrice({
        selectedTier: null,
        customPrice: new Prisma.Decimal('139.00'),
        starTiers: TIERS,
      }),
    ).toBe('139.00');
  });

  it('resolves a TIER-only row to that tier’s upper threshold', () => {
    expect(
      resolveAdvantageExportPrice({
        selectedTier: 'tier2',
        customPrice: null,
        starTiers: TIERS,
      }),
    ).toBe('274.42');
  });

  it('prefers the custom price over the tier when both are set (custom wins)', () => {
    expect(
      resolveAdvantageExportPrice({
        selectedTier: 'tier1',
        customPrice: new Prisma.Decimal('150.00'),
        starTiers: TIERS,
      }),
    ).toBe('150.00');
  });

  it('returns null for a not-joined row (neither tier nor custom)', () => {
    expect(
      resolveAdvantageExportPrice({ selectedTier: null, customPrice: null, starTiers: TIERS }),
    ).toBeNull();
  });

  it('returns null when the selected tier is absent from the stored tiers', () => {
    expect(
      resolveAdvantageExportPrice({ selectedTier: 'tier3', customPrice: null, starTiers: [] }),
    ).toBeNull();
  });

  it('normalizes the custom price to 2dp', () => {
    expect(
      resolveAdvantageExportPrice({
        selectedTier: null,
        customPrice: new Prisma.Decimal('139'),
        starTiers: TIERS,
      }),
    ).toBe('139.00');
  });
});
