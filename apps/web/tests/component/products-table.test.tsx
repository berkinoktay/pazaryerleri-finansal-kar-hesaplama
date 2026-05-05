import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

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
      properties: 'Özellikler',
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
      searchPlaceholder: 'Ürün adı, model kodu, stok kodu, barkod ile ara…',
      statusOptions: {
        onSale: 'Satışta',
        archived: 'Arşivde',
        locked: 'Kilitli',
        blacklisted: 'Engelli',
      },
    },
    facets: {
      brand: {
        trigger: '+ Marka',
        active: 'Marka: {name}',
        clear: 'Markayı temizle',
        search: 'Marka ara…',
        noResults: 'Sonuç yok',
      },
      category: {
        trigger: '+ Kategori',
        active: 'Kategori: {name}',
        clear: 'Kategoriyi temizle',
        search: 'Kategori ara…',
        noResults: 'Sonuç yok',
      },
      status: {
        trigger: '+ Durum',
        active: 'Durum: {label}',
        clear: 'Durumu temizle',
      },
    },
  },
  common: {
    dataTable: {
      empty: { title: 'Sonuç yok', description: 'Filtreleri değiştirin.' },
      toolbar: {
        searchPlaceholder: 'Ara…',
        clear: 'Temizle',
        import: 'İçeri aktar',
        export: 'Dışarı aktar',
        toggleColumns: 'Sütunlar',
        visibleColumns: 'Görünür sütunlar',
        pinLeft: 'Sola sabitle',
        pinRight: 'Sağa sabitle',
      },
      pagination: {
        rowsOf: '{shown} / {total} satır',
        rowsPerPage: 'Sayfa başına',
        pageOf: 'Sayfa {page} / {total}',
        first: 'İlk sayfa',
        previous: 'Önceki sayfa',
        next: 'Sonraki sayfa',
        last: 'Son sayfa',
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

const noop = (): void => {};

const baseProps = {
  loading: false,
  pagination: { page: 1, perPage: 25, total: 1, totalPages: 1 },
  q: '',
  status: 'onSale' as const,
  brandId: '',
  categoryId: '',
  overrideMissing: null,
  sort: '-platformModifiedAt' as const,
  facets: undefined,
  // Override-state tab strip lives inside the DataTable shell now —
  // the table owns rendering, the page client owns URL state.
  overrideTab: 'all' as const,
  overrideCounts: undefined,
  facetsLoading: false,
  onOverrideTabChange: noop,
  onSearchChange: noop,
  onStatusChange: noop,
  onBrandChange: noop,
  onCategoryChange: noop,
  onSortChange: noop,
  onPageChange: noop,
  onPerPageChange: noop,
};

function renderTable(data: ProductWithVariants[]) {
  return render(
    <NextIntlClientProvider locale="tr" messages={messages} formats={FORMATS}>
      <ProductsTable {...baseProps} data={data} />
    </NextIntlClientProvider>,
  );
}

describe('ProductsTable', () => {
  it('renders single-variant products flat (no chevron)', () => {
    const product = makeProduct({
      title: 'Solo Product',
      variantCount: 1,
      variants: [makeVariant({ stockCode: 'STK-SOLO', barcode: 'BC-SOLO' })],
    });
    renderTable([product]);
    expect(screen.getByText('Solo Product')).toBeInTheDocument();
    expect(screen.getByText('BC-SOLO')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Varyantları göster' })).toBeNull();
  });

  it('renders multi-variant parent with count chip; clicking expands variant rows', async () => {
    const product = makeProduct({
      title: 'Multi Product',
      variantCount: 2,
      variants: [
        makeVariant({ id: 'v-2a', size: 'S', stockCode: 'STK-S' }),
        makeVariant({ id: 'v-2b', size: 'L', stockCode: 'STK-L' }),
      ],
    });
    const { user } = renderTable([product]);
    const trigger = screen.getByRole('button', { name: 'Varyantları göster' });
    // Count chip surfaces variantCount up-front (no need to expand to find out)
    expect(trigger).toHaveTextContent('2');
    // Parent row shows aggregate Beden chips (S, L)
    expect(screen.getByText('S')).toBeInTheDocument();
    expect(screen.getByText('L')).toBeInTheDocument();

    await user.click(trigger);
    // Variant rows now visible — assert by stock codes
    expect(screen.getByText(/STK-S/)).toBeInTheDocument();
    expect(screen.getByText(/STK-L/)).toBeInTheDocument();
    // Variant rows carry data-depth='1' (DataTable contract)
    const variantRow = screen.getByText(/STK-S/).closest('tr');
    expect(variantRow?.getAttribute('data-depth')).toBe('1');
    // After expand, parent + variant sub-row each render a chip for "S"
    expect(screen.getAllByText('S')).toHaveLength(2);
  });

  it('renders Renk column from product.color on parent rows', () => {
    const product = makeProduct({
      title: 'Colorful Product',
      color: 'Antrasit',
      variantCount: 1,
      variants: [makeVariant()],
    });
    renderTable([product]);
    expect(screen.getByText('Antrasit')).toBeInTheDocument();
  });

  it('renders em-dash placeholder when product.color is null', () => {
    const product = makeProduct({
      title: 'Colorless Product',
      color: null,
      variantCount: 1,
      variants: [makeVariant({ size: null })],
    });
    renderTable([product]);
    // Both Beden and Renk fall back to em-dash; getAllByText handles it.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('caps Beden chip list at 4 visible + overflow chip', () => {
    const product = makeProduct({
      title: 'Many Sizes',
      variantCount: 6,
      variants: [
        makeVariant({ id: 'v-1', size: 'XS' }),
        makeVariant({ id: 'v-2', size: 'S' }),
        makeVariant({ id: 'v-3', size: 'M' }),
        makeVariant({ id: 'v-4', size: 'L' }),
        makeVariant({ id: 'v-5', size: 'XL' }),
        makeVariant({ id: 'v-6', size: 'XXL' }),
      ],
    });
    renderTable([product]);
    // First 4 unique sizes render as chips, remaining 2 collapse into +N
    expect(screen.getByText('XS')).toBeInTheDocument();
    expect(screen.getByText('S')).toBeInTheDocument();
    expect(screen.getByText('M')).toBeInTheDocument();
    expect(screen.getByText('L')).toBeInTheDocument();
    expect(screen.queryByText('XL')).toBeNull();
    expect(screen.queryByText('XXL')).toBeNull();
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('shows the empty-state slot when data is empty', () => {
    render(
      <NextIntlClientProvider locale="tr" messages={messages} formats={FORMATS}>
        <ProductsTable {...baseProps} data={[]} empty={<div>Filtreyle eşleşen ürün yok.</div>} />
      </NextIntlClientProvider>,
    );
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
    expect(screen.getByText('Satışta')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
  });
});
