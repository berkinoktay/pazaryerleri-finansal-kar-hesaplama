import { describe, expect, it } from 'vitest';

import type {
  ProductWithVariants,
  VariantSummary,
} from '@/features/products/api/list-products.api';
import { aggregateMissingShipping } from '@/features/products/lib/aggregate-missing-shipping';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeVariant(overrides: Partial<VariantSummary> = {}): VariantSummary {
  return {
    id: 'variant-uuid-001',
    platformVariantId: '10010',
    barcode: 'BC-0001',
    stockCode: 'STK-A',
    size: null,
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
    shippingEstimateStatus: 'OK',
    ...overrides,
  };
}

function makeProduct(variants: VariantSummary[]): ProductWithVariants {
  return {
    id: 'product-uuid-001',
    productMainId: 'MAIN-1',
    platformContentId: '12345',
    title: 'Test product',
    description: null,
    brand: { id: null, name: null },
    category: { id: null, name: null },
    color: null,
    images: [],
    variantCount: variants.length,
    variants,
    lastSyncedAt: '2026-05-01T00:00:00Z',
    platformModifiedAt: null,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('aggregateMissingShipping', () => {
  it('returns all zeros when every variant is OK', () => {
    const products = [
      makeProduct([makeVariant({ shippingEstimateStatus: 'OK' })]),
      makeProduct([makeVariant({ shippingEstimateStatus: 'OK' })]),
    ];
    expect(aggregateMissingShipping(products)).toEqual({
      total: 0,
      noDesi: 0,
      noCarrier: 0,
      overflow: 0,
    });
  });

  it('returns all zeros for an empty product array', () => {
    expect(aggregateMissingShipping([])).toEqual({
      total: 0,
      noDesi: 0,
      noCarrier: 0,
      overflow: 0,
    });
  });

  it('counts NO_DESI into the noDesi bucket', () => {
    const products = [
      makeProduct([
        makeVariant({ shippingEstimateStatus: 'NO_DESI' }),
        makeVariant({ shippingEstimateStatus: 'NO_DESI' }),
      ]),
    ];
    expect(aggregateMissingShipping(products)).toEqual({
      total: 2,
      noDesi: 2,
      noCarrier: 0,
      overflow: 0,
    });
  });

  it('counts NO_CARRIER and OWN_CONTRACT_EMPTY into the same noCarrier bucket (V1 policy)', () => {
    const products = [
      makeProduct([
        makeVariant({ shippingEstimateStatus: 'NO_CARRIER' }),
        makeVariant({ shippingEstimateStatus: 'OWN_CONTRACT_EMPTY' }),
        makeVariant({ shippingEstimateStatus: 'OWN_CONTRACT_EMPTY' }),
      ]),
    ];
    expect(aggregateMissingShipping(products)).toEqual({
      total: 3,
      noDesi: 0,
      noCarrier: 3,
      overflow: 0,
    });
  });

  it('counts DESI_OVERFLOW into the overflow bucket', () => {
    const products = [makeProduct([makeVariant({ shippingEstimateStatus: 'DESI_OVERFLOW' })])];
    expect(aggregateMissingShipping(products)).toEqual({
      total: 1,
      noDesi: 0,
      noCarrier: 0,
      overflow: 1,
    });
  });

  it('mixes buckets correctly across products and variants', () => {
    const products = [
      makeProduct([
        makeVariant({ shippingEstimateStatus: 'OK' }),
        makeVariant({ shippingEstimateStatus: 'NO_DESI' }),
      ]),
      makeProduct([
        makeVariant({ shippingEstimateStatus: 'NO_CARRIER' }),
        makeVariant({ shippingEstimateStatus: 'DESI_OVERFLOW' }),
      ]),
      makeProduct([
        makeVariant({ shippingEstimateStatus: 'OWN_CONTRACT_EMPTY' }),
        makeVariant({ shippingEstimateStatus: 'OK' }),
        makeVariant({ shippingEstimateStatus: 'NO_DESI' }),
      ]),
    ];
    expect(aggregateMissingShipping(products)).toEqual({
      total: 5,
      noDesi: 2,
      noCarrier: 2,
      overflow: 1,
    });
  });
});
