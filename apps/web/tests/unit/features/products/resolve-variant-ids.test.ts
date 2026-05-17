import { describe, expect, it } from 'vitest';

import { resolveVariantIds } from '@/features/products/components/products-bulk-cost-action-bar';
import type { ProductRow } from '@/features/products/components/products-bulk-cost-action-bar.types';
import type {
  ProductWithVariants,
  VariantSummary,
} from '@/features/products/api/list-products.api';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeVariant(id: string, overrides: Partial<VariantSummary> = {}): VariantSummary {
  return {
    id,
    platformVariantId: id,
    barcode: `BC-${id}`,
    stockCode: `STK-${id}`,
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

function makeProduct(
  id: string,
  variantIds: string[],
  overrides: Partial<ProductWithVariants> = {},
): ProductWithVariants {
  return {
    id,
    productMainId: `PM-${id}`,
    platformContentId: id,
    title: `Product ${id}`,
    description: null,
    brand: { id: 'b1', name: 'Brand' },
    category: { id: 'c1', name: 'Category' },
    color: null,
    images: [],
    variantCount: variantIds.length,
    variants: variantIds.map((vid) => makeVariant(vid)),
    lastSyncedAt: '2026-01-01T00:00:00Z',
    platformModifiedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('resolveVariantIds', () => {
  it('returns variant id directly for variant rows', () => {
    const parentProduct = makeProduct('p1', ['v1', 'v2']);
    const rows: ProductRow[] = [
      { kind: 'variant', parent: parentProduct, variant: makeVariant('v1') },
    ];
    expect(resolveVariantIds(rows)).toEqual(['v1']);
  });

  it('expands parent rows to all their child variant ids', () => {
    const product = makeProduct('p1', ['v1', 'v2', 'v3']);
    const rows: ProductRow[] = [{ kind: 'parent', product }];
    expect(resolveVariantIds(rows)).toEqual(['v1', 'v2', 'v3']);
  });

  it('handles mixed parent + variant selection without duplicating', () => {
    // Parent product p1 with variants v1, v2. Variant v3 from a different product.
    const product1 = makeProduct('p1', ['v1', 'v2']);
    const product2 = makeProduct('p2', ['v3', 'v4']);
    const rows: ProductRow[] = [
      { kind: 'parent', product: product1 },
      { kind: 'variant', parent: product2, variant: makeVariant('v3') },
    ];
    expect(resolveVariantIds(rows)).toEqual(['v1', 'v2', 'v3']);
  });

  it('returns empty array for empty selection', () => {
    expect(resolveVariantIds([])).toEqual([]);
  });

  it('deduplication is caller responsibility — duplicates can appear if same variant selected twice', () => {
    // This documents the current behaviour: resolveVariantIds does NOT deduplicate.
    // The API handles idempotency on its side.
    const product = makeProduct('p1', ['v1', 'v2']);
    const variant = makeVariant('v1');
    const rows: ProductRow[] = [
      { kind: 'parent', product },
      { kind: 'variant', parent: product, variant },
    ];
    const ids = resolveVariantIds(rows);
    // v1 appears twice: once from parent expansion, once from direct variant row.
    expect(ids.filter((id) => id === 'v1').length).toBe(2);
  });
});
