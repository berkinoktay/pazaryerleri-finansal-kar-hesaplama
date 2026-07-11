import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ParentRowCostCell } from '@/features/products/components/parent-row-cost-cell';
import type {
  ProductWithVariants,
  VariantSummary,
} from '@/features/products/api/list-products.api';

import { render, screen } from '../../../helpers/render';

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

function makeProduct(variantOverrides: Partial<VariantSummary>[] = []): ProductWithVariants {
  const variants = variantOverrides.map((ov, i) => makeVariant(`v${i + 1}`, ov));
  return {
    id: 'p-test',
    productMainId: 'PMID-1',
    platformContentId: '1001',
    title: 'Test Product',
    description: null,
    brand: { id: '1', name: 'Brand' },
    category: { id: '2', name: 'Category' },
    color: null,
    images: [],
    variantCount: variants.length,
    variants,
    lastSyncedAt: '2026-01-01T00:00:00Z',
    platformModifiedAt: '2026-01-01T00:00:00Z',
  };
}

// Stub out the hooks used by ParentRowCostCell so the component renders
// in isolation without real API calls.
vi.mock('@/features/costs/hooks/use-cost-profiles', () => ({
  useCostProfiles: () => ({ data: null, isLoading: false }),
}));
vi.mock('@/features/costs/hooks/use-attach-cost-profiles', () => ({
  useAttachCostProfiles: () => ({ mutate: vi.fn(), isPending: false }),
}));

function renderCell(product: ProductWithVariants) {
  // The shared render wrapper provides the real Turkish catalog + QueryClient.
  return render(<ParentRowCostCell orgId="org-1" storeId="store-1" product={product} />);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('<ParentRowCostCell>', () => {
  describe('no cost profiles', () => {
    it('shows add-cost placeholder when no variants have profiles', () => {
      const product = makeProduct([
        { profileCount: 0, currentCostTry: null },
        { profileCount: 0, currentCostTry: null },
      ]);
      renderCell(product);
      // The "+" is a PlusSignIcon; the label is products.costCell.addCost.
      expect(screen.getByRole('button', { name: 'Maliyet ekle' })).toBeInTheDocument();
    });
  });

  describe('all same cost', () => {
    it('shows the shared currency amount alone (no count chip) when all variants match', () => {
      const product = makeProduct([
        { profileCount: 1, currentCostTry: '142.50', costStatus: 'OK' },
        { profileCount: 1, currentCostTry: '142.50', costStatus: 'OK' },
      ]);
      renderCell(product);
      // formatCurrency(142.50) = "₺142,50"
      expect(screen.getByText(/142/)).toBeInTheDocument();
      // When all variants share a cost, no variant-count chip is rendered.
      expect(screen.queryByText('2')).not.toBeInTheDocument();
    });
  });

  describe('cost range', () => {
    it('shows the cost range + a variant-count chip when costs differ across variants', () => {
      const product = makeProduct([
        { profileCount: 1, currentCostTry: '120.00', costStatus: 'OK' },
        { profileCount: 1, currentCostTry: '180.00', costStatus: 'OK' },
      ]);
      renderCell(product);
      // Range trigger renders "₺120,00 – ₺180,00" across text nodes...
      expect(screen.getByText(/120/)).toBeInTheDocument();
      expect(screen.getByText(/180/)).toBeInTheDocument();
      // ...plus a chip showing the raw variant count number, not "2 varyant".
      expect(screen.getByText('2')).toBeInTheDocument();
    });
  });
});
