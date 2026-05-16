import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';

import {
  ProductsBulkCostActionBar,
  resolveVariantIds,
} from '@/features/products/components/products-bulk-cost-action-bar';
import type { ProductRow } from '@/features/products/components/products-bulk-cost-action-bar.types';
import type {
  ProductWithVariants,
  VariantSummary,
} from '@/features/products/api/list-products.api';

import { render, screen } from '../../../helpers/render';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/features/costs/hooks/use-cost-profiles', () => ({
  useCostProfiles: () => ({ data: null, isLoading: false }),
}));
vi.mock('@/features/costs/hooks/use-attach-cost-profiles', () => ({
  useAttachCostProfiles: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/features/costs/hooks/use-detach-cost-profiles', () => ({
  useDetachCostProfiles: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/features/costs/hooks/use-replace-cost-profiles', () => ({
  useReplaceCostProfiles: () => ({ mutate: vi.fn(), isPending: false }),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const messages = {
  products: {
    bulkCost: {
      selectedCount: '{count} ürün seçili',
      clearSelection: 'Seçimi temizle',
      attach: 'Maliyet ekle',
      detach: 'Maliyet kaldır',
      replace: 'Maliyetleri değiştir',
      attachDialog: {
        title: 'Maliyet ekle',
        placeholder: 'Profil seç…',
        search: 'Profil ara…',
        empty: 'Profil bulunamadı',
      },
      detachDialog: {
        title: 'Maliyet kaldır',
        placeholder: 'Kaldırılacak profili seç…',
        search: 'Profil ara…',
        empty: 'Profil bulunamadı',
      },
      replaceDialog: {
        title: 'Maliyetleri değiştir',
        placeholder: 'Yeni profili seç…',
        search: 'Profil ara…',
        empty: 'Profil bulunamadı',
      },
      replaceConfirm: {
        title: 'Maliyetleri değiştir',
        description: 'Bu işlem {count} varyantın...',
        confirm: 'Evet, değiştir',
      },
    },
  },
  common: {
    cancel: 'İptal',
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
    ...overrides,
  };
}

function makeProduct(id: string, variantIds: string[]): ProductWithVariants {
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
  };
}

function makeParentRow(id: string, variantIds: string[]): ProductRow {
  return { kind: 'parent', product: makeProduct(id, variantIds) };
}

function makeVariantRow(parentId: string, variantId: string): ProductRow {
  return {
    kind: 'variant',
    parent: makeProduct(parentId, [variantId]),
    variant: makeVariant(variantId),
  };
}

function renderBar(rows: ProductRow[], onClear = vi.fn()) {
  return render(
    <NextIntlClientProvider locale="tr" messages={messages}>
      <ProductsBulkCostActionBar
        orgId="org-1"
        storeId="store-1"
        selectedRows={rows}
        onClearSelection={onClear}
      />
    </NextIntlClientProvider>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('<ProductsBulkCostActionBar>', () => {
  describe('visibility', () => {
    it('shows count label when rows are selected', () => {
      renderBar([makeParentRow('p1', ['v1'])]);
      // The component passes selectedRows.length directly to BulkActionBar.
      // The caller (products-table) gates on >= 2 before rendering this component.
      // With 1 row the bar is still rendered (since selectedCount=1 > 0 in BulkActionBar).
      expect(screen.getByText('1 ürün seçili')).toBeInTheDocument();
    });

    it('renders the bar when 2+ rows are selected', () => {
      renderBar([makeParentRow('p1', ['v1']), makeParentRow('p2', ['v2'])]);
      expect(screen.getByText('2 ürün seçili')).toBeInTheDocument();
    });
  });

  describe('action buttons', () => {
    it('renders all three action buttons', () => {
      renderBar([makeParentRow('p1', ['v1']), makeParentRow('p2', ['v2'])]);
      expect(screen.getByRole('button', { name: 'Maliyet ekle' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Maliyet kaldır' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Maliyetleri değiştir' })).toBeInTheDocument();
    });

    it('opens attach dialog when "Maliyet ekle" is clicked', async () => {
      const { user } = renderBar([makeParentRow('p1', ['v1']), makeParentRow('p2', ['v2'])]);
      await user.click(screen.getByRole('button', { name: 'Maliyet ekle' }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('clear button', () => {
    it('calls onClearSelection when the clear button is clicked', async () => {
      const onClear = vi.fn();
      const { user } = renderBar(
        [makeParentRow('p1', ['v1']), makeParentRow('p2', ['v2'])],
        onClear,
      );
      await user.click(screen.getByRole('button', { name: 'Seçimi temizle' }));
      expect(onClear).toHaveBeenCalledOnce();
    });
  });

  describe('resolveVariantIds integration', () => {
    it('expands parent rows to their child variant ids', () => {
      const rows: ProductRow[] = [makeParentRow('p1', ['v1', 'v2']), makeVariantRow('p2', 'v3')];
      const ids = resolveVariantIds(rows);
      expect(ids).toContain('v1');
      expect(ids).toContain('v2');
      expect(ids).toContain('v3');
      expect(ids.length).toBe(3);
    });
  });
});
