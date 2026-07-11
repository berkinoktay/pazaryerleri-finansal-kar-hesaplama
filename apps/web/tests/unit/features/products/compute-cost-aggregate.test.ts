import { describe, expect, it } from 'vitest';

import { computeCostAggregate } from '@/features/products/components/parent-row-cost-cell';
import type { VariantSummary } from '@/features/products/api/list-products.api';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeVariant(overrides: Partial<VariantSummary> = {}): VariantSummary {
  return {
    id: `v-${Math.random().toString(36).slice(2, 8)}`,
    platformVariantId: '10010',
    barcode: 'BC-0001',
    stockCode: 'STK-A',
    size: 'M',
    salePrice: '100.00',
    listPrice: '100.00',
    vatRate: 20,
    costPrice: null,
    quantity: 5,
    deliveryDuration: 1,
    isRushDelivery: false,
    fastDeliveryOptions: [],
    productUrl: null,
    locationBasedDelivery: 'DISABLED',
    status: 'onSale',
    delistedAt: null,
    currentCostTry: null,
    profileCount: 0,
    costStatus: 'NO_PROFILES',
    dimensionalWeight: null,
    syncedDimensionalWeight: null,
    isDimensionalWeightOverridden: false,
    estimatedShippingNet: null,
    shippingCarrierCode: null,
    shippingTariffApplied: null,
    shippingEstimateStatus: 'NO_DESI',
    ...overrides,
  };
}

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

  it('excludes variants with profileCount > 0 but null currentCostTry from range calc', () => {
    // Edge case: variant has profiles but FX rate is stale — currentCostTry is null.
    const variants = [
      makeVariant({ profileCount: 1, currentCostTry: '100.00', costStatus: 'OK' }),
      makeVariant({ profileCount: 1, currentCostTry: null, costStatus: 'FX_STALE' }),
    ];
    const result = computeCostAggregate(variants);
    expect(result).not.toBeNull();
    // Only the variant with a real cost value participates in min/max.
    expect(result!.min).toBe(100);
    expect(result!.max).toBe(100);
    expect(result!.isSame).toBe(true);
    // Both variants count as "with profiles".
    expect(result!.withProfiles).toBe(2);
  });
});
