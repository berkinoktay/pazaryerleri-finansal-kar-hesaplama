import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';

import { ParentRowCostCell } from '@/features/products/components/parent-row-cost-cell';
import type {
  ProductWithVariants,
  VariantSummary,
} from '@/features/products/api/list-products.api';

import { render, screen } from '../../../helpers/render';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const messages = {
  products: {
    costCell: {
      addCost: '+ Maliyet ekle',
      profileCount: '{count} profil',
      popover: {
        title: 'Maliyet profilleri',
        attachPlaceholder: 'Profil seç…',
        attachSearch: 'Profil ara…',
        attachEmpty: 'Profil bulunamadı',
        newProfile: '+ Yeni maliyet oluştur',
        removeLabel: 'Profili kaldır',
      },
    },
    parentCostCell: {
      allSame: 'tümü aynı',
      variantCount: '{count} varyant',
      popoverTitle: 'Varyant maliyetleri',
      popoverStats: '{with} / {total} varyant maliyet profiline sahip, {without} eksik',
      applyToAllLabel: 'Tüm varyantlara maliyet ekle',
      applyToAllPlaceholder: 'Profil seç…',
      applyToAllSearch: 'Profil ara…',
      applyToAllEmpty: 'Profil bulunamadı',
    },
  },
  common: {
    copy: { copy: '{label} kopyala', copied: '{label} kopyalandı' },
    combobox: { searchPlaceholder: 'Ara…', empty: 'Sonuç yok', trigger: 'Seç…' },
  },
};

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
  return render(
    <NextIntlClientProvider locale="tr" messages={messages}>
      <ParentRowCostCell orgId="org-1" product={product} />
    </NextIntlClientProvider>,
  );
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
      expect(screen.getByText('+ Maliyet ekle')).toBeInTheDocument();
    });
  });

  describe('all same cost', () => {
    it('shows "tümü aynı" badge when all variants share the same cost', () => {
      const product = makeProduct([
        { profileCount: 1, currentCostTry: '142.50', costStatus: 'OK' },
        { profileCount: 1, currentCostTry: '142.50', costStatus: 'OK' },
      ]);
      renderCell(product);
      expect(screen.getByText('tümü aynı')).toBeInTheDocument();
    });
  });

  describe('cost range', () => {
    it('shows variant count badge when costs differ across variants', () => {
      const product = makeProduct([
        { profileCount: 1, currentCostTry: '120.00', costStatus: 'OK' },
        { profileCount: 1, currentCostTry: '180.00', costStatus: 'OK' },
      ]);
      renderCell(product);
      expect(screen.getByText('2 varyant')).toBeInTheDocument();
    });
  });
});
