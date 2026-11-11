import { describe, expect, it } from 'vitest';

import { computeCostAggregate } from '@/features/products/components/parent-row-cost-cell';

import { makeVariantSummary as makeVariant } from '../../../helpers/product-fixtures';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// Variants come from the shared builder (tests/helpers/product-fixtures.ts);
// computeCostAggregate never reads ids, so the shared default id is enough.

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('computeCostAggregate', () => {
  it('returns null when no variants have cost profiles', () => {
    const variants = [
      makeVariant({ profileCount: 0, currentCostTry: null }),
      makeVariant({ profileCount: 0, currentCostTry: null }),
    ];
    expect(computeCostAggregate(variants)).toBeNull();
  });

  it('returns null for empty variants array', () => {
    expect(computeCostAggregate([])).toBeNull();
  });

  it('detects "all same" when all variants with profiles share the same cost', () => {
    const variants = [
      makeVariant({ profileCount: 1, currentCostTry: '142.50', costStatus: 'OK' }),
      makeVariant({ profileCount: 2, currentCostTry: '142.50', costStatus: 'OK' }),
      makeVariant({ profileCount: 1, currentCostTry: '142.50', costStatus: 'OK' }),
    ];
    const result = computeCostAggregate(variants);
    expect(result).not.toBeNull();
    expect(result!.isSame).toBe(true);
    expect(result!.sameValue).toBe('142.50');
    expect(result!.min).toBe(142.5);
    expect(result!.max).toBe(142.5);
  });

  it('detects range when variants have different costs', () => {
    const variants = [
      makeVariant({ profileCount: 1, currentCostTry: '120.00', costStatus: 'OK' }),
      makeVariant({ profileCount: 1, currentCostTry: '150.00', costStatus: 'OK' }),
      makeVariant({ profileCount: 1, currentCostTry: '180.00', costStatus: 'OK' }),
    ];
    const result = computeCostAggregate(variants);
    expect(result).not.toBeNull();
    expect(result!.isSame).toBe(false);
    expect(result!.sameValue).toBeNull();
    expect(result!.min).toBe(120);
    expect(result!.max).toBe(180);
  });

  it('counts variants with and without profiles correctly', () => {
    const variants = [
      makeVariant({ profileCount: 1, currentCostTry: '50.00', costStatus: 'OK' }),
      makeVariant({ profileCount: 0, currentCostTry: null, costStatus: 'NO_PROFILES' }),
      makeVariant({ profileCount: 2, currentCostTry: '75.00', costStatus: 'OK' }),
    ];
    const result = computeCostAggregate(variants);
    expect(result).not.toBeNull();
    expect(result!.withProfiles).toBe(2);
    expect(result!.withoutProfiles).toBe(1);
  });
});
