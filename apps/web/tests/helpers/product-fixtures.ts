import { ProductVariantStatus } from '@pazarsync/db/enums';

import type {
  ProductWithVariants,
  VariantSummary,
} from '@/features/products/api/list-products.api';

// Shared builders for the products list wire types (VariantSummary and
// ProductWithVariants). Every products test builds its rows here, so a
// contract change after `pnpm api:sync` is absorbed in one place instead of
// in one hand-written copy per test file.
//
// Defaults describe one plain variant: on sale, in stock, no cost profile and
// no shipping estimate. Desi mirrors the wire shape: the default is a stored desi
// of 0 (the column default; a Trendyol 0 is stored as null), a real desi, so it is
// NOT flagged missing. A variant without any desi arrives with null desi fields
// and the backend's missing flag; spread MISSING_DESI_FIELDS to model that
// "Desi gir" variant (the backend owns the rule). Ids are deterministic; pass
// explicit ids whenever a test renders several rows that must stay distinct.

const DEFAULT_VARIANT_ID = 'v-1';
const DEFAULT_PRODUCT_ID = 'p-1';

/** The wire desi fields of a variant with no desi at all: no override, no Trendyol desi. */
export const MISSING_DESI_FIELDS = {
  dimensionalWeight: null,
  syncedDimensionalWeight: null,
  isDimensionalWeightOverridden: false,
  isDimensionalWeightMissing: true,
} satisfies Partial<VariantSummary>;

export function makeVariantSummary(overrides: Partial<VariantSummary> = {}): VariantSummary {
  return {
    id: DEFAULT_VARIANT_ID,
    platformVariantId: '10010',
    barcode: 'BC-0001',
    stockCode: 'STK-A',
    size: 'M',
    salePrice: '100.00',
    listPrice: '100.00',
    vatRate: 20,
    dimensionalWeight: '0',
    syncedDimensionalWeight: '0',
    isDimensionalWeightOverridden: false,
    isDimensionalWeightMissing: false,
    quantity: 5,
    deliveryDuration: 1,
    productUrl: null,
    status: ProductVariantStatus.ON_SALE,
    statusReason: null,
    delistedAt: null,
    currentCostTry: null,
    profileCount: 0,
    costStatus: 'NO_PROFILES',
    estimatedShippingNet: null,
    shippingCarrierCode: null,
    shippingTariffApplied: null,
    shippingEstimateStatus: 'NO_DESI',
    ...overrides,
  };
}

/** `variantCount` follows `variants` unless the caller overrides it explicitly. */
export function makeProductWithVariants(
  overrides: Partial<ProductWithVariants> = {},
): ProductWithVariants {
  const variants = overrides.variants ?? [makeVariantSummary()];
  return {
    id: DEFAULT_PRODUCT_ID,
    productMainId: 'PMID-1',
    platformContentId: '1001',
    title: 'Test Product',
    brand: { id: '1', name: 'Test Brand' },
    category: { id: '2', name: 'Test Category' },
    color: null,
    imageUrls: [],
    variantCount: variants.length,
    variants,
    lastSyncedAt: '2026-04-27T12:00:00Z',
    platformModifiedAt: '2026-04-26T12:00:00Z',
    ...overrides,
  };
}
