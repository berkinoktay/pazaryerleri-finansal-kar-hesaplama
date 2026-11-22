import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { ProductVariantStatus } from '@pazarsync/db/enums';

import type { ProductWithVariants } from '@/features/products/api/list-products.api';
import { ProductsTable } from '@/features/products/components/products-table';
import { FORMATS } from '@/i18n/formats';

import trMessages from '../../messages/tr.json';

// Shared builders under this file's historical local names, so the test
// bodies below (and later edits to them) keep reading unchanged.
import {
  MISSING_DESI_FIELDS,
  makeProductWithVariants as makeProduct,
  makeVariantSummary as makeVariant,
} from '@/../tests/helpers/product-fixtures';
import { http, HttpResponse, server } from '@/../tests/helpers/msw';
import { render, screen, waitFor } from '@/../tests/helpers/render';

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
    delivery: trMessages.products.delivery,
    statusBadge: trMessages.products.statusBadge,
    statusReasons: trMessages.products.statusReasons,
    table: {
      variantDelisted: 'Delisted',
    },
    multiVariantPlaceholder: '{n} varyant',
    empty: { filtered: 'Filtreyle eşleşen ürün yok.' },
    a11y: { expandRow: 'Varyantları göster', collapseRow: 'Varyantları gizle' },
    filters: {
      searchPlaceholder: 'Ürün adı, model kodu, stok kodu, barkod ile ara…',
      statusOptions: trMessages.products.filters.statusOptions,
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
  },
  common: {
    copy: {
      copy: '{label} kopyala',
      copied: '{label} kopyalandı',
    },
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

const noop = (): void => {};

const baseProps = {
  orgId: '00000000-0000-0000-0000-000000000001',
  storeId: '00000000-0000-0000-0000-000000000002',
  loading: false,
  pagination: { page: 1, perPage: 25, total: 1, totalPages: 1 },
  q: '',
  overrideMissing: null,
  sort: '-platformModifiedAt' as const,
  filterFields: [],
  filterRows: [],
  onFiltersApply: noop,
  // Override-state tab strip lives inside the DataTable shell now —
  // the table owns rendering, the page client owns URL state.
  overrideTab: 'all' as const,
  overrideCounts: undefined,
  facetsLoading: false,
  onOverrideTabChange: noop,
  onSearchChange: noop,
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
  const deliveryMessages = trMessages.products.delivery;
  const statusBadgeMessages = trMessages.products.statusBadge;

  // Text content of the table row that renders `identifier` (a stock code or model code).
  function rowText(identifier: string): string {
    return screen.getByText(identifier).closest('tr')?.textContent ?? '';
  }

  it('shows the status badge and its reason button on a single-variant parent row', () => {
    renderTable([
      makeProduct({
        id: 'p-locked-solo',
        variantCount: 1,
        variants: [
          makeVariant({
            id: 'v-locked-solo',
            stockCode: 'STK-LOCKED-SOLO',
            status: ProductVariantStatus.LOCKED,
            statusReason: 'CRITICAL_SALE_PRICE_CHANGE',
            quantity: 4,
            delistedAt: null,
          }),
        ],
      }),
    ]);

    expect(rowText('STK-LOCKED-SOLO')).toContain(statusBadgeMessages.locked);
    expect(
      screen.getByRole('button', {
        name: statusBadgeMessages.reasonAria.replace('{label}', statusBadgeMessages.locked),
      }),
    ).toBeInTheDocument();
  });

  it('splits not-on-sale variant rows into out-of-stock and closed badges', async () => {
    const { user } = renderTable([
      makeProduct({
        id: 'p-stock-split',
        variantCount: 3,
        variants: [
          makeVariant({
            id: 'v-out',
            stockCode: 'STK-OUT',
            status: ProductVariantStatus.NOT_ON_SALE,
            quantity: 0,
            delistedAt: null,
          }),
          makeVariant({
            id: 'v-closed',
            stockCode: 'STK-CLOSED',
            status: ProductVariantStatus.NOT_ON_SALE,
            quantity: 6,
            delistedAt: null,
          }),
          makeVariant({
            id: 'v-on',
            stockCode: 'STK-ON',
            status: ProductVariantStatus.ON_SALE,
            quantity: 6,
            delistedAt: null,
          }),
        ],
      }),
    ]);
    // Collapsed, the multi-variant parent row only shows the aggregate count.
    expect(screen.queryByText(statusBadgeMessages.outOfStock)).toBeNull();
    expect(screen.queryByText(statusBadgeMessages.closed)).toBeNull();

    await user.click(screen.getByRole('button', { name: messages.products.a11y.expandRow }));

    expect(rowText('STK-OUT')).toContain(statusBadgeMessages.outOfStock);
    expect(rowText('STK-CLOSED')).toContain(statusBadgeMessages.closed);
    expect(rowText('STK-ON')).not.toContain(statusBadgeMessages.outOfStock);
    expect(rowText('STK-ON')).not.toContain(statusBadgeMessages.closed);
  });

  it('shows the delisted badge instead of the status badge on a single-variant parent row', () => {
    renderTable([
      makeProduct({
        id: 'p-delisted-solo',
        variantCount: 1,
        variants: [
          makeVariant({
            id: 'v-delisted-solo',
            stockCode: 'STK-DELISTED-SOLO',
            status: ProductVariantStatus.LOCKED,
            statusReason: 'CRITICAL_SALE_PRICE_CHANGE',
            delistedAt: '2026-10-20T09:00:00Z',
          }),
        ],
      }),
    ]);

    const text = rowText('STK-DELISTED-SOLO');
    expect(text).toContain(messages.products.table.variantDelisted);
    expect(text).not.toContain(statusBadgeMessages.locked);
  });

  it('renders delivery badges from deliveryDuration', () => {
    renderTable([
      makeProduct({
        id: 'p-today',
        variantCount: 1,
        variants: [makeVariant({ id: 'v-today', stockCode: 'STK-TODAY', deliveryDuration: 0 })],
      }),
      makeProduct({
        id: 'p-tomorrow',
        variantCount: 1,
        variants: [
          makeVariant({ id: 'v-tomorrow', stockCode: 'STK-TOMORROW', deliveryDuration: 1 }),
        ],
      }),
      makeProduct({
        id: 'p-later',
        variantCount: 1,
        variants: [makeVariant({ id: 'v-later', stockCode: 'STK-LATER', deliveryDuration: 3 })],
      }),
      makeProduct({
        id: 'p-unknown',
        color: 'White',
        variantCount: 1,
        variants: [
          makeVariant({
            id: 'v-unknown',
            stockCode: 'STK-UNKNOWN',
            size: 'M',
            salePrice: '100.00',
            deliveryDuration: null,
          }),
        ],
      }),
      makeProduct({
        id: 'p-mixed',
        productMainId: 'PMID-MIXED',
        variantCount: 2,
        variants: [
          makeVariant({ id: 'v-mixed-a', stockCode: 'STK-MIXED-A', deliveryDuration: 0 }),
          makeVariant({ id: 'v-mixed-b', stockCode: 'STK-MIXED-B', deliveryDuration: 1 }),
        ],
      }),
    ]);

    expect(rowText('STK-TODAY')).toContain(deliveryMessages.today);
    expect(rowText('STK-TOMORROW')).toContain(deliveryMessages.tomorrow);
    expect(rowText('STK-LATER')).toContain(deliveryMessages.inDays.replace('{days}', '3'));
    // Size, color and price are set on this row, so its only em dash is the delivery cell.
    expect(rowText('STK-UNKNOWN')).toContain('\u2014');
    expect(rowText('PMID-MIXED')).toContain(deliveryMessages.mixed);
  });

  it('renders single-variant products flat (no chevron)', () => {
    const product = makeProduct({
      title: 'Solo Product',
      variantCount: 1,
      variants: [makeVariant({ stockCode: 'STK-SOLO', barcode: 'BC-SOLO' })],
      imageUrls: [
        'https://cdn.example.com/solo-first.jpg',
        'https://cdn.example.com/solo-second.jpg',
      ],
    });
    renderTable([product]);
    expect(screen.getByText('Solo Product')).toBeInTheDocument();
    // The row thumbnail is the product's first image.
    expect(screen.getByRole('img', { name: 'Solo Product' })).toHaveAttribute(
      'src',
      'https://cdn.example.com/solo-first.jpg',
    );
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
      imageUrls: [
        'https://cdn.example.com/multi-first.jpg',
        'https://cdn.example.com/multi-second.jpg',
      ],
    });
    const { user } = renderTable([product]);
    const trigger = screen.getByRole('button', { name: 'Varyantları göster' });
    // Count chip surfaces variantCount up-front (no need to expand to find out)
    expect(trigger).toHaveTextContent('2');
    // Parent's Beden cell shows the aggregate "N varyant" summary, not
    // a chip per size — Trendyol's panel does the same when the variant
    // count is high; long size strings would otherwise wrap into a
    // tall, busy stack.
    expect(screen.getByText('2 varyant')).toBeInTheDocument();
    // The actual sizes are NOT mapped onto the parent row.
    expect(screen.queryByText('S')).toBeNull();
    expect(screen.queryByText('L')).toBeNull();

    await user.click(trigger);
    // Variant rows now visible — assert by stock codes
    expect(screen.getByText(/STK-S/)).toBeInTheDocument();
    expect(screen.getByText(/STK-L/)).toBeInTheDocument();
    // Variant rows carry data-depth='1' (DataTable contract)
    const variantRow = screen.getByText(/STK-S/).closest('tr');
    expect(variantRow?.getAttribute('data-depth')).toBe('1');
    // Once expanded, each variant sub-row renders its own size chip.
    expect(screen.getByText('S')).toBeInTheDocument();
    // The parent row and both variant sub-rows show the product's first image.
    const thumbnails = screen.getAllByRole('img', { name: 'Multi Product' });
    expect(thumbnails).toHaveLength(3);
    for (const thumbnail of thumbnails) {
      expect(thumbnail).toHaveAttribute('src', 'https://cdn.example.com/multi-first.jpg');
    }
    expect(screen.getByText('L')).toBeInTheDocument();
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

  it('parent Beden cell shows only the variant count, not individual sizes', () => {
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
    // The cell collapses to "N varyant" (matches Trendyol's seller-panel
    // pattern for products with many variants — the actual sizes are
    // available in the expanded sub-rows).
    expect(screen.getByText('6 varyant')).toBeInTheDocument();
    // None of the individual sizes leak into the parent row.
    expect(screen.queryByText('XS')).toBeNull();
    expect(screen.queryByText('S')).toBeNull();
    expect(screen.queryByText('M')).toBeNull();
    expect(screen.queryByText('L')).toBeNull();
    expect(screen.queryByText('XL')).toBeNull();
    expect(screen.queryByText('XXL')).toBeNull();
    // No "+N" overflow chip on the parent either — the count text
    // already conveys cardinality.
    expect(screen.queryByText('+2')).toBeNull();
  });

  it('shows the empty-state slot when data is empty', () => {
    render(
      <NextIntlClientProvider locale="tr" messages={messages} formats={FORMATS}>
        <ProductsTable
          {...baseProps}
          orgId="00000000-0000-0000-0000-000000000001"
          data={[]}
          empty={<div>Filtreyle eşleşen ürün yok.</div>}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('Filtreyle eşleşen ürün yok.')).toBeInTheDocument();
  });

  it('renders 0 stock with destructive color and >0 with default', () => {
    const product = makeProduct({
      title: 'Stock Tier Product',
      variantCount: 1,
      // A non-zero desi keeps the stock cell the only "0" on the row.
      variants: [
        makeVariant({ quantity: 0, dimensionalWeight: '1.20', syncedDimensionalWeight: '1.20' }),
      ],
    });
    renderTable([product]);
    const cell = screen.getByText('0');
    // Destructive class signals "out of stock" — see StockCount in
    // products-table.tsx for the tier ladder.
    expect(cell.className).toMatch(/text-destructive/);
  });

  it('renders low stock (1-9) with warning tone', () => {
    const product = makeProduct({
      title: 'Low Stock Product',
      variantCount: 1,
      variants: [makeVariant({ quantity: 5 })],
    });
    renderTable([product]);
    const cell = screen.getByText('5');
    expect(cell.className).toMatch(/text-warning/);
  });

  it('offers "Desi gir" on the collapsed row of a product whose variants all miss desi', () => {
    const product = makeProduct({
      title: 'All Missing Desi',
      variantCount: 2,
      variants: [
        makeVariant({ id: 'v-m1', size: 'S', stockCode: 'STK-M1', ...MISSING_DESI_FIELDS }),
        makeVariant({ id: 'v-m2', size: 'M', stockCode: 'STK-M2', ...MISSING_DESI_FIELDS }),
      ],
    });
    // Rendered with the full tr.json catalog from the shared render helper.
    render(<ProductsTable {...baseProps} data={[product]} />);
    // One call to action for the whole product while its variant rows are collapsed.
    expect(
      screen.getAllByRole('button', { name: trMessages.products.desiCell.addDesi }),
    ).toHaveLength(1);
  });

  it('shows the known desi on the collapsed row when only some variants miss desi', () => {
    const product = makeProduct({
      title: 'Partly Missing Desi',
      variantCount: 2,
      variants: [
        makeVariant({
          id: 'v-k',
          size: 'S',
          stockCode: 'STK-K',
          dimensionalWeight: '1.50',
          syncedDimensionalWeight: '1.50',
        }),
        makeVariant({ id: 'v-m', size: 'M', stockCode: 'STK-M', ...MISSING_DESI_FIELDS }),
      ],
    });
    render(<ProductsTable {...baseProps} data={[product]} />);
    expect(screen.getByText('1,5')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: trMessages.products.desiCell.addDesi })).toBeNull();
  });

  it('renders the delisted badge only on delisted variant sub-rows', async () => {
    const product = makeProduct({
      title: 'Freshness Product',
      variantCount: 2,
      variants: [
        makeVariant({
          id: 'v-del',
          size: 'S',
          stockCode: 'STK-DEL',
          delistedAt: '2026-05-01T09:00:00Z',
        }),
        makeVariant({ id: 'v-live', size: 'L', stockCode: 'STK-LIVE', delistedAt: null }),
      ],
    });
    const { user } = renderTable([product]);
    // Collapsed: variant sub-rows (and their badges) are not rendered yet.
    expect(screen.queryByText('Delisted')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Varyantları göster' }));

    // Exactly one badge, and it lives on the delisted variant's row — the
    // listed sibling stays chip-free (there is no positive counterpart).
    const badges = screen.getAllByText('Delisted');
    expect(badges).toHaveLength(1);
    const delistedRow = screen.getByText(/STK-DEL/).closest('tr');
    const listedRow = screen.getByText(/STK-LIVE/).closest('tr');
    expect(delistedRow?.textContent).toContain('Delisted');
    expect(listedRow?.textContent).not.toContain('Delisted');
  });
});

describe('ProductsTable store switch', () => {
  it('saves desi to the new store after a store switch re-renders the table', async () => {
    const nextStoreId = '00000000-0000-0000-0000-000000000003';
    const desiMessages = trMessages.products.desiCell;
    const requestedStoreIds: string[] = [];
    server.use(
      http.patch(
        'http://localhost:3001/v1/organizations/:orgId/stores/:storeId/products/variants/:variantId/dimensional-weight',
        ({ params }) => {
          requestedStoreIds.push(String(params['storeId']));
          return HttpResponse.json({
            id: 'v-desi',
            dimensionalWeight: '2',
            syncedDimensionalWeight: '0',
            isDimensionalWeightOverridden: true,
            isDimensionalWeightMissing: false,
          });
        },
      ),
    );
    const data = [
      makeProduct({
        id: 'p-desi',
        variantCount: 1,
        variants: [makeVariant({ id: 'v-desi', stockCode: 'STK-DESI', ...MISSING_DESI_FIELDS })],
      }),
    ];

    // Rendered with the full tr.json catalog from the shared render helper.
    const { rerender, user } = render(<ProductsTable {...baseProps} data={data} />);
    // A store switch runs router.refresh(): the page re-renders this table with
    // the new storeId instead of remounting it.
    rerender(<ProductsTable {...baseProps} storeId={nextStoreId} data={data} />);

    await user.click(screen.getByRole('button', { name: desiMessages.addDesi }));
    await user.type(screen.getByLabelText(desiMessages.popover.title), '2');
    await user.click(screen.getByRole('button', { name: desiMessages.popover.save }));

    await waitFor(() => expect(requestedStoreIds).toEqual([nextStoreId]));
  });
});
