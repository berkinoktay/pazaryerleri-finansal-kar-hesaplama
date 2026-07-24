import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import type { AdvantageCommissionBand } from '@/features/campaigns/api/get-advantage-tariff-detail.api';
import {
  findBandByCommissionPct,
  findBandForPrice,
  formatBandRange,
  type BandRangeLabelFns,
} from '@/features/campaigns/lib/commission-band-range';

// The mockup's four-band ladder (top-down). Windows are 0,01 apart — Trendyol's real
// bands don't touch: band1 is open above, band4 open below.
const BAND1: AdvantageCommissionBand = {
  lowerLimit: '181.10',
  upperLimit: null,
  commissionPct: '19.0000',
};
const BAND2: AdvantageCommissionBand = {
  lowerLimit: '163.89',
  upperLimit: '181.09',
  commissionPct: '13.9000',
};
const BAND3: AdvantageCommissionBand = {
  lowerLimit: '146.01',
  upperLimit: '163.88',
  commissionPct: '10.7000',
};
const BAND4: AdvantageCommissionBand = {
  lowerLimit: null,
  upperLimit: '146.00',
  commissionPct: '6.5000',
};
const LADDER: readonly AdvantageCommissionBand[] = [BAND1, BAND2, BAND3, BAND4];

function bandPctAt(price: string): string | null {
  return findBandForPrice(LADDER, new Decimal(price))?.commissionPct ?? null;
}

describe('findBandForPrice', () => {
  it('lands a below-threshold price in the open-below bottom band (the 128,25 product)', () => {
    // A product whose 128,25-based candidates price at 130 or 139 stays in "₺146,00 ve altı".
    expect(bandPctAt('130')).toBe('6.5000');
    expect(bandPctAt('139')).toBe('6.5000');
  });

  it('keeps the bottom-band ceiling in the bottom band, the next cent in the band above', () => {
    expect(bandPctAt('146.00')).toBe('6.5000'); // ceiling → bottom band
    expect(bandPctAt('146.01')).toBe('10.7000'); // next cent → band above
  });

  it('resolves the middle windows and the open-above top band', () => {
    expect(bandPctAt('155')).toBe('10.7000'); // band3
    expect(bandPctAt('170')).toBe('13.9000'); // band2
    expect(bandPctAt('190')).toBe('19.0000'); // band1 (open above)
  });

  it('returns the HIGHER band on a shared (touching) boundary', () => {
    const touching: readonly AdvantageCommissionBand[] = [
      { lowerLimit: '100.00', upperLimit: null, commissionPct: '19.0000' },
      { lowerLimit: '50.00', upperLimit: '100.00', commissionPct: '10.0000' },
    ];
    // 100 is in BOTH windows; iterating top-down returns the higher band — the same
    // semantic the backend `bandForPrice` uses.
    expect(findBandForPrice(touching, new Decimal('100.00'))?.commissionPct).toBe('19.0000');
  });

  it('returns null for an empty ladder', () => {
    expect(findBandForPrice([], new Decimal('130'))).toBeNull();
  });
});

describe('findBandByCommissionPct', () => {
  it('marks the band carrying the charged rate regardless of decimal formatting', () => {
    // The cell charges the discounted-scenario rate; matching by that rate marks the right band
    // even for X-al-Y / Nth where the rate comes from the CURRENT price band, not the shown price.
    expect(findBandByCommissionPct(LADDER, '19.0000')?.commissionPct).toBe('19.0000');
    expect(findBandByCommissionPct(LADDER, '10.7000')?.commissionPct).toBe('10.7000');
    // Numeric compare: an unpadded "6.5" still matches the ladder's "6.5000".
    expect(findBandByCommissionPct(LADDER, '6.5')?.commissionPct).toBe('6.5000');
  });

  it('returns null when no band carries the rate, and for an empty ladder', () => {
    expect(findBandByCommissionPct(LADDER, '99.0000')).toBeNull();
    expect(findBandByCommissionPct([], '19.0000')).toBeNull();
  });
});

// Inject trivial formatters so the pure helper is tested framework-free (the real
// formatCurrency + next-intl templates are covered by the component test).
const LABELS: BandRangeLabelFns = {
  above: (price) => `${price} ve üzeri`,
  range: (lower, upper) => `${lower}–${upper}`,
  below: (price) => `${price} ve altı`,
};
const money = (value: string): string => `₺${value}`;

describe('formatBandRange', () => {
  it('formats the open-above top band as "… ve üzeri"', () => {
    expect(formatBandRange(BAND1, money, LABELS)).toBe('₺181.10 ve üzeri');
  });

  it('formats a two-bound middle band as a range', () => {
    expect(formatBandRange(BAND2, money, LABELS)).toBe('₺163.89–₺181.09');
  });

  it('formats the open-below bottom band as "… ve altı"', () => {
    expect(formatBandRange(BAND4, money, LABELS)).toBe('₺146.00 ve altı');
  });

  it('returns null for a degenerate band with neither bound', () => {
    expect(formatBandRange({ lowerLimit: null, upperLimit: null }, money, LABELS)).toBeNull();
  });
});
