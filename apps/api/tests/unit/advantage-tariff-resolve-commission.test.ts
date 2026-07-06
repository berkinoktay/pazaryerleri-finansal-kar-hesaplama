import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  resolveCommission,
  type ItemCommissionInputs,
} from '@/services/advantage-tariff-compute.service';
import type { StoredBand } from '@/services/commission-tariff.types';

// BUG-1 investigation: "a custom price above a band takes that band's (lower) rate".
//
// Repro claim: a commission band has UPPER limit 128.25 @ 6.5%; typing custom price 139
// (above that band) applies 6.5% instead of the rate of the band that CONTAINS 139.
//
// These tests reconstruct that exact scenario against `resolveCommission` (the single
// commission-resolution path the custom-price estimate uses → `bandForPrice`). They
// prove the resolution already picks the CONTAINING band (upper wins on a shared
// boundary, category only when no band covers the price) — the working commission
// vertical's semantics. A well-formed Trendyol ladder (band1 open-top + band4
// open-bottom) covers every 2dp price, so 139 lands in the band spanning it, never the
// band below.

/** Contiguous Trendyol ladder: band4 open-bottom @ 6.5% (upper 128.25), band3 covers 139. */
const LADDER: StoredBand[] = [
  { key: 'band1', lowerLimit: '200.00', upperLimit: null, commissionPct: '15' }, // [200, ∞)
  { key: 'band2', lowerLimit: '150.00', upperLimit: '199.99', commissionPct: '12' }, // [150, 199.99]
  { key: 'band3', lowerLimit: '128.26', upperLimit: '149.99', commissionPct: '9' }, // [128.26, 149.99]
  { key: 'band4', lowerLimit: null, upperLimit: '128.25', commissionPct: '6.5' }, // (-∞, 128.25]
];

const inputs = (bands: StoredBand[] | null, categoryRate: string | null): ItemCommissionInputs => ({
  bands,
  categoryRate: categoryRate !== null ? new Decimal(categoryRate) : null,
});

describe('resolveCommission — price above the 6.5% (upper 128.25) band', () => {
  it('139 resolves to the band CONTAINING it (band3 @ 9%), NOT the band below it (6.5%)', () => {
    const resolved = resolveCommission(inputs(LADDER, '18'), new Decimal('139'));
    expect(resolved).not.toBeNull();
    expect(resolved?.source).toBe('band');
    // The heart of the repro: it must be 9% (band3, which contains 139), never 6.5%.
    expect(resolved?.pct.toString()).toBe('9');
  });

  it('128.25 (the band4 boundary) stays in band4 @ 6.5% (its own upper), correctly', () => {
    const resolved = resolveCommission(inputs(LADDER, '18'), new Decimal('128.25'));
    expect(resolved?.pct.toString()).toBe('6.5');
  });

  it('129.00 (just above band4) already resolves to band3 @ 9% — the commission steps up', () => {
    const resolved = resolveCommission(inputs(LADDER, '18'), new Decimal('129.00'));
    expect(resolved?.pct.toString()).toBe('9');
  });

  it('a high price above band1 floor resolves to band1 base % (no discount)', () => {
    const resolved = resolveCommission(inputs(LADDER, '18'), new Decimal('250.00'));
    expect(resolved?.pct.toString()).toBe('15');
  });

  it('falls back to category only when NO band covers the price (incomplete ladder)', () => {
    // band4 removed → nothing covers a price ≤ 128.25; 100 has no containing band.
    const partial = LADDER.filter((b) => b.key !== 'band4');
    const resolved = resolveCommission(inputs(partial, '18'), new Decimal('100.00'));
    expect(resolved?.source).toBe('category');
    expect(resolved?.pct.toString()).toBe('18');
  });
});
