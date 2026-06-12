import { describe, expect, it } from 'vitest';

import { LiveTodayProducts } from '@/features/live-performance/components/live-today-products';

import { render, screen, waitFor, within } from '../../../helpers/render';
import { server, http, HttpResponse } from '../../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const STORE_ID = '00000000-0000-0000-0000-000000000002';
const URL = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/live-performance/today-products`;

const response = {
  data: [
    {
      variantId: 'v-top',
      barcode: '8690000000001',
      stockCode: 'STK-TOP',
      productName: 'En Çok Satan',
      thumbUrl: null,
      orderCount: 9,
      unitsSold: 14,
      revenue: '3600.00',
      costStatus: 'costed',
      unitCost: '42.00',
      unresolved: false,
    },
    {
      variantId: 'v-mid',
      barcode: '8690000000002',
      stockCode: 'STK-MID',
      productName: 'Orta Ürün',
      thumbUrl: null,
      orderCount: 3,
      unitsSold: 5,
      revenue: '900.00',
      costStatus: 'missing',
      unitCost: null,
      unresolved: false,
    },
    {
      variantId: 'v-low1',
      barcode: '8690000000003',
      stockCode: 'STK-LOW1',
      productName: 'Düşük Ürün',
      thumbUrl: null,
      orderCount: 2,
      unitsSold: 3,
      revenue: '300.00',
      costStatus: 'missing',
      unitCost: null,
      unresolved: false,
    },
    {
      variantId: 'v-low2',
      barcode: '8690000000005',
      stockCode: 'STK-LOW2',
      productName: 'En Düşük Ürün',
      thumbUrl: null,
      orderCount: 1,
      unitsSold: 2,
      revenue: '200.00',
      costStatus: 'costed',
      unitCost: '12.00',
      unresolved: false,
    },
  ],
};

describe('LiveTodayProducts', () => {
  it('renders one row per product with a podium medal on the top seller, copyable identifiers, costed unit cost and a cost-missing CTA', async () => {
    server.use(http.get(URL, () => HttpResponse.json(response)));

    render(<LiveTodayProducts orgId={ORG_ID} storeId={STORE_ID} />);

    await waitFor(() => expect(screen.getByText('En Çok Satan')).toBeInTheDocument());
    // Top seller (highest units) gets rank 1 — the medal exposes its rank to AT.
    expect(screen.getByText('1. sıra')).toBeInTheDocument();
    // Identity cell exposes both copyable identifiers (CopyableValue → button).
    // Every product row renders its own pair, so scope to the top seller's row.
    const topRow = screen.getByText('En Çok Satan').closest('tr');
    if (!(topRow instanceof HTMLElement)) throw new Error('top seller row not found');
    expect(within(topRow).getByRole('button', { name: 'Stok Kodu kopyala' })).toBeInTheDocument();
    expect(within(topRow).getByRole('button', { name: 'Barkod kopyala' })).toBeInTheDocument();
    // Cost-missing products surface the inline add-cost action (two missing rows in the fixture).
    expect(screen.getAllByRole('button', { name: /Maliyet Ekle/ })).toHaveLength(2);
    // Rank 4+ rows show a plain number, not a medal (no rankLabel sr-only text).
    // Scope to the 4th seller's row — the FilterTabs "Tümü" count badge also reads 4.
    const rank4Row = screen.getByText('En Düşük Ürün').closest('tr');
    if (!(rank4Row instanceof HTMLElement)) throw new Error('rank-4 row not found');
    expect(within(rank4Row).getByText('4')).toBeInTheDocument();
    expect(within(rank4Row).queryByText('4. sıra')).toBeNull();
  });

  it('çözülemeyen satır barkod kimliği + rozetle görünür; attach CTA yerine nötr çizgi', async () => {
    const unresolvedResponse = {
      data: [
        ...response.data,
        {
          variantId: null,
          barcode: 'GHOST-1',
          stockCode: null,
          productName: null,
          thumbUrl: null,
          orderCount: 1,
          unitsSold: 1,
          revenue: '45.00',
          costStatus: 'missing',
          unitCost: null,
          unresolved: true,
        },
      ],
    };
    server.use(http.get(URL, () => HttpResponse.json(unresolvedResponse)));

    render(<LiveTodayProducts orgId={ORG_ID} storeId={STORE_ID} />);

    // Kimlik ham barkoda düşer + rozet — satır asla sessizce kaybolmaz
    // (görünürlük sözleşmesi, spec 2026-06-12 §7).
    await waitFor(() => expect(screen.getAllByText('GHOST-1').length).toBeGreaterThan(0));
    expect(screen.getByText('Eşleşme bekliyor')).toBeInTheDocument();
    const ghostRow = screen.getAllByText('GHOST-1')[0]?.closest('tr');
    if (!(ghostRow instanceof HTMLElement)) throw new Error('unresolved row not found');
    // Variant yok → maliyet bağlanamaz: CTA yerine nötr çizgi.
    expect(within(ghostRow).queryByRole('button', { name: /Maliyet Ekle/ })).toBeNull();
    expect(within(ghostRow).getByText('—')).toBeInTheDocument();
  });

  it('filters to cost-missing products when the "Maliyet bekleyen" tab is selected', async () => {
    server.use(http.get(URL, () => HttpResponse.json(response)));

    const { user } = render(<LiveTodayProducts orgId={ORG_ID} storeId={STORE_ID} />);

    await waitFor(() => expect(screen.getByText('En Çok Satan')).toBeInTheDocument());

    await user.click(screen.getByRole('tab', { name: /Maliyet bekleyen/ }));

    // The costed products leave the table; the cost-missing ones stay.
    await waitFor(() => expect(screen.queryByText('En Çok Satan')).toBeNull());
    expect(screen.queryByText('En Düşük Ürün')).toBeNull();
    expect(screen.getByText('Orta Ürün')).toBeInTheDocument();
    expect(screen.getByText('Düşük Ürün')).toBeInTheDocument();
  });
});
