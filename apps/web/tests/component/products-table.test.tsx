import { describe, expect, it } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';

import type { ProductWithVariants } from '@/features/products/api/list-products.api';
import { ProductsTable } from '@/features/products/components/products-table';
import { FORMATS } from '@/i18n/formats';

import { render, screen } from '@/../tests/helpers/render';

// Stripped-down translations covering only what ProductsTable + its
// children read. Keeps the test deterministic without loading the full
// tr.json blob into the test harness.
const messages = {
  products: {
    columns: {
      title: 'Ürün',
      brand: 'Marka',
      category: 'Kategori',
      productMainId: 'Model',
      stockCode: 'Stok Kodu',
      barcode: 'Barkod',
      color: 'Renk',
      size: 'Beden',
      variants: 'Varyant',
      delivery: 'Teslimat',
      salePrice: 'Fiyat',
      stock: 'Stok',
      status: 'Durum',
    },
    delivery: {
      sameDay: 'Bugün kargoda',
      nextDay: 'Yarın kargoda',
      days: '{n} gün',
      standard: 'Standart',
      mixed: 'Karışık',
    },
    multiVariantPlaceholder: '{n} varyant',
    empty: { filtered: 'Filtreyle eşleşen ürün yok.' },
    a11y: { expandRow: 'Varyantları göster', collapseRow: 'Varyantları gizle' },
    filters: {
      statusOptions: {
        onSale: 'Satışta',
        archived: 'Arşivde',
        locked: 'Kilitli',
        blacklisted: 'Engelli',
      },
    },
  },
};

function makeVariant(
  overrides: Partial<ProductWithVariants['variants'][number]> = {},
): ProductWithVariants['variants'][number] {
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
    isRushDelivery: true,
    fastDeliveryOptions: [],
    productUrl: null,
    locationBasedDelivery: 'DISABLED',
    status: 'onSale',
    ...overrides,
  };
}

function makeProduct(overrides: Partial<ProductWithVariants> = {}): ProductWithVariants {
  return {
    id: `p-${Math.random().toString(36).slice(2, 8)}`,
    productMainId: 'PMID-1',
    platformContentId: '1001',
    title: 'Test Product',
    description: null,
    brand: { id: '1', name: 'Modline' },
    category: { id: '2', name: 'Gömlek' },
    color: 'Beyaz',
    images: [],
    variantCount: 1,
    variants: [makeVariant()],
    lastSyncedAt: '2026-04-27T12:00:00Z',
    platformModifiedAt: '2026-04-26T12:00:00Z',
    ...overrides,
  };
}

function renderTable(data: ProductWithVariants[]) {
  return render(
    <NextIntlClientProvider locale="tr" messages={messages} formats={FORMATS}>
      <ProductsTable data={data} />
    </NextIntlClientProvider>,
  );
}

describe('ProductsTable', () => {
  it('renders a single-variant product flat (no expand chevron)', () => {
    const product = makeProduct({
      title: 'Solo Product',
      variantCount: 1,
      variants: [makeVariant({ stockCode: 'STK-SOLO', barcode: 'BC-SOLO' })],
    });
    renderTable([product]);

    expect(screen.getByText('Solo Product')).toBeInTheDocument();
    expect(screen.getByText('STK-SOLO')).toBeInTheDocument();
    expect(screen.getByText('BC-SOLO')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Varyantları göster' })).toBeNull();
  });

  it('renders a multi-variant product with expand chevron and "{n} varyant" placeholder', () => {
    const product = makeProduct({
      title: 'Multi Product',
      variantCount: 3,
      variants: [
        makeVariant({ id: 'v-1', size: 'S', stockCode: 'STK-S' }),
        makeVariant({ id: 'v-2', size: 'M', stockCode: 'STK-M' }),
        makeVariant({ id: 'v-3', size: 'L', stockCode: 'STK-L' }),
      ],
    });
    renderTable([product]);

    expect(screen.getByText('Multi Product')).toBeInTheDocument();
    expect(screen.getAllByText('3 varyant').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Varyantları göster' })).toBeInTheDocument();
    // Variant detail rows are NOT visible until the chevron is clicked.
    expect(screen.queryByText('STK-S')).toBeNull();
  });

  it('toggles the variant sub-table when the expand chevron is clicked', async () => {
    const product = makeProduct({
      title: 'Multi Product',
      variantCount: 2,
      variants: [
        makeVariant({ id: 'v-1', size: 'S', stockCode: 'STK-S' }),
        makeVariant({ id: 'v-2', size: 'M', stockCode: 'STK-M' }),
      ],
    });
    const { user } = renderTable([product]);

    await user.click(screen.getByRole('button', { name: 'Varyantları göster' }));
    expect(screen.getByText('STK-S')).toBeInTheDocument();
    expect(screen.getByText('STK-M')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Varyantları gizle' }));
    expect(screen.queryByText('STK-S')).toBeNull();
  });

  it('shows the empty-state slot when data is empty', () => {
    renderTable([]);
    expect(screen.getByText('Filtreyle eşleşen ürün yok.')).toBeInTheDocument();
  });

  it('aggregates the status chip across mixed variants with an overflow count', () => {
    const product = makeProduct({
      title: 'Mixed Product',
      variantCount: 3,
      variants: [
        makeVariant({ id: 'v-1', status: 'onSale' }),
        makeVariant({ id: 'v-2', status: 'onSale' }),
        makeVariant({ id: 'v-3', status: 'archived' }),
      ],
    });
    renderTable([product]);
    // Dominant status is "onSale" (2 of 3) — Satışta badge plus a "+1"
    // overflow chip showing the archived variant exists.
    expect(screen.getByText('Satışta')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
  });
});
