import { NuqsTestHarness } from '../../../helpers/nuqs';
import { describe, expect, it } from 'vitest';

import type { TodayProductRow } from '@/features/live-performance/api/get-live-today-products.api';
import { LiveTodayProducts } from '@/features/live-performance/components/live-today-products';

import trMessages from '../../../../messages/tr.json';
import { render, screen, waitFor, within } from '../../../helpers/render';
import { server, http, HttpResponse } from '../../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const STORE_ID = '00000000-0000-0000-0000-000000000002';
const API = 'http://localhost:3001/v1';
const URL = `${API}/organizations/${ORG_ID}/stores/${STORE_ID}/live-performance/today-products`;
const MISSING_DESI_PATCH_URL = `${API}/organizations/${ORG_ID}/stores/${STORE_ID}/products/variants/v-mid/dimensional-weight`;

// One store profile the cost popover can attach (mirrors cost-cell-popover.test.tsx).
const PACKAGING_PROFILE = {
  id: 'profile-uuid-002',
  organizationId: ORG_ID,
  storeId: STORE_ID,
  name: 'Paketleme',
  type: 'PACKAGING',
  amountGross: '10.00',
  vatRate: 18,
  note: null,
  archivedAt: null,
  createdBy: null,
  updatedBy: null,
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
};

const desiPopover = trMessages.products.desiCell.popover;

// Desi fixtures (the backend owns the missing flag; the web never derives it):
//   v-top  -> marketplace desi 2.5 (shown as "2,5")
//   v-mid  -> missing desi ("Desi Gir" action)
//   v-low1 -> digital product without desi (not missing, shown as a dash)
//   v-low2 -> seller desi of 0 (a real desi, shown as "0")
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
      vendorMissing: false,
      dimensionalWeight: '2.5',
      syncedDimensionalWeight: '2.5',
      isDimensionalWeightOverridden: false,
      isDimensionalWeightMissing: false,
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
      vendorMissing: false,
      dimensionalWeight: null,
      syncedDimensionalWeight: null,
      isDimensionalWeightOverridden: false,
      isDimensionalWeightMissing: true,
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
      vendorMissing: false,
      dimensionalWeight: null,
      syncedDimensionalWeight: null,
      isDimensionalWeightOverridden: false,
      isDimensionalWeightMissing: false,
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
      vendorMissing: false,
      dimensionalWeight: '0',
      syncedDimensionalWeight: null,
      isDimensionalWeightOverridden: true,
      isDimensionalWeightMissing: false,
    },
  ] satisfies TodayProductRow[],
};

function renderTable() {
  return render(
    <NuqsTestHarness>
      <LiveTodayProducts orgId={ORG_ID} storeId={STORE_ID} />
    </NuqsTestHarness>,
  );
}

async function findRow(text: string): Promise<HTMLElement> {
  const row = (await screen.findAllByText(text))[0]?.closest('tr');
  if (!(row instanceof HTMLElement)) throw new Error(`row "${text}" not found`);
  return row;
}

// The body cell of `row` under the column whose (non-sortable) header reads `header`.
function cellUnder(row: HTMLElement, header: string): HTMLElement {
  const index = screen
    .getAllByRole('columnheader')
    .findIndex((th) => th.textContent?.trim() === header);
  const cell = within(row).getAllByRole('cell')[index];
  if (index === -1 || !(cell instanceof HTMLElement)) {
    throw new Error(`no "${header}" cell in the row`);
  }
  return cell;
}

describe('LiveTodayProducts', () => {
  it('renders one row per product with a podium medal on the top seller, copyable identifiers, costed unit cost and a cost-missing CTA', async () => {
    server.use(http.get(URL, () => HttpResponse.json(response)));

    render(
      <NuqsTestHarness>
        <LiveTodayProducts orgId={ORG_ID} storeId={STORE_ID} />
      </NuqsTestHarness>,
    );

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
          vendorMissing: false,
          dimensionalWeight: null,
          syncedDimensionalWeight: null,
          isDimensionalWeightOverridden: false,
          isDimensionalWeightMissing: false,
        } satisfies TodayProductRow,
      ],
    };
    server.use(http.get(URL, () => HttpResponse.json(unresolvedResponse)));

    render(
      <NuqsTestHarness>
        <LiveTodayProducts orgId={ORG_ID} storeId={STORE_ID} />
      </NuqsTestHarness>,
    );

    // Kimlik ham barkoda düşer + rozet — satır asla sessizce kaybolmaz
    // (görünürlük sözleşmesi, spec 2026-06-12 §7).
    await waitFor(() => expect(screen.getAllByText('GHOST-1').length).toBeGreaterThan(0));
    expect(screen.getByText('Eşleşme bekliyor')).toBeInTheDocument();
    const ghostRow = screen.getAllByText('GHOST-1')[0]?.closest('tr');
    if (!(ghostRow instanceof HTMLElement)) throw new Error('unresolved row not found');
    // Variant yok → maliyet bağlanamaz: CTA yerine nötr çizgi.
    expect(within(ghostRow).queryByRole('button', { name: /Maliyet Ekle/ })).toBeNull();
    expect(within(cellUnder(ghostRow, 'Maliyet')).getByText('—')).toBeInTheDocument();
  });

  it('shows the desi value, a Desi Gir action for a missing desi and a dash for an unresolved row', async () => {
    server.use(
      http.get(URL, () =>
        HttpResponse.json({
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
              vendorMissing: false,
              dimensionalWeight: null,
              syncedDimensionalWeight: null,
              isDimensionalWeightOverridden: false,
              isDimensionalWeightMissing: false,
            } satisfies TodayProductRow,
          ],
        }),
      ),
    );

    renderTable();

    const topRow = await findRow('En Çok Satan');
    expect(within(cellUnder(topRow, 'Desi')).getByText('2,5')).toBeInTheDocument();

    const midRow = await findRow('Orta Ürün');
    expect(
      within(cellUnder(midRow, 'Desi')).getByRole('button', { name: 'Desi Gir' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Desi Gir' })).toHaveLength(1);

    // Digital product without desi: not missing, so a dash and no action.
    const digitalRow = await findRow('Düşük Ürün');
    expect(within(cellUnder(digitalRow, 'Desi')).getByText('—')).toBeInTheDocument();

    // Unresolved barcode: no variant to edit, so a dash in both columns, no action.
    const ghostRow = await findRow('GHOST-1');
    expect(within(cellUnder(ghostRow, 'Desi')).getByText('—')).toBeInTheDocument();
    expect(within(cellUnder(ghostRow, 'Maliyet')).getByText('—')).toBeInTheDocument();
    expect(within(ghostRow).queryByRole('button', { name: 'Desi Gir' })).toBeNull();
  });

  it('shows a seller desi of 0 as 0, not as an action', async () => {
    server.use(http.get(URL, () => HttpResponse.json(response)));

    renderTable();

    const zeroRow = await findRow('En Düşük Ürün');
    const desiCell = cellUnder(zeroRow, 'Desi');
    expect(within(desiCell).getByText('0')).toBeInTheDocument();
    expect(within(desiCell).queryByRole('button')).toBeNull();
  });

  it('filters to missing-desi products on the Desi bekleyen tab', async () => {
    server.use(http.get(URL, () => HttpResponse.json(response)));

    const { user } = renderTable();

    await findRow('En Çok Satan');
    const desiTab = screen.getByRole('tab', { name: /Desi bekleyen/ });
    // Only v-mid is flagged missing: the digital row and the 0-desi row are not.
    expect(within(desiTab).getByText('1')).toBeInTheDocument();

    await user.click(desiTab);

    await waitFor(() => expect(screen.queryByText('En Çok Satan')).toBeNull());
    expect(screen.getByText('Orta Ürün')).toBeInTheDocument();
    expect(screen.queryByText('Düşük Ürün')).toBeNull();
    expect(screen.queryByText('En Düşük Ürün')).toBeNull();
  });

  it('refreshes the live data after a desi save', async () => {
    let getCalls = 0;
    server.use(
      http.get(URL, () => {
        getCalls += 1;
        return HttpResponse.json(response);
      }),
      http.patch(MISSING_DESI_PATCH_URL, () =>
        HttpResponse.json({
          id: 'v-mid',
          dimensionalWeight: '1.5',
          syncedDimensionalWeight: null,
          isDimensionalWeightOverridden: true,
          isDimensionalWeightMissing: false,
        }),
      ),
    );

    const { user } = renderTable();

    const midRow = await findRow('Orta Ürün');
    expect(getCalls).toBe(1);
    await user.click(within(midRow).getByRole('button', { name: 'Desi Gir' }));
    await user.type(screen.getByLabelText(desiPopover.title), '1,5');
    await user.click(screen.getByRole('button', { name: desiPopover.save }));

    await waitFor(() => expect(getCalls).toBe(2));
  });

  it('refreshes the live data after a cost attach', async () => {
    let getCalls = 0;
    server.use(
      http.get(URL, () => {
        getCalls += 1;
        return HttpResponse.json(response);
      }),
      http.get(`${API}/organizations/${ORG_ID}/variants/v-mid/cost-profiles`, () =>
        HttpResponse.json({ data: [] }),
      ),
      http.get(`${API}/organizations/${ORG_ID}/cost-profiles`, () =>
        HttpResponse.json({
          data: [PACKAGING_PROFILE],
          meta: { nextCursor: null, hasMore: false },
        }),
      ),
      http.post(`${API}/organizations/${ORG_ID}/cost-profile-attachments/attach`, () =>
        HttpResponse.json({ attached: 1 }),
      ),
    );

    const { user } = renderTable();

    // v-mid is cost-missing; its barcode keeps the lookup ASCII.
    const midRow = await findRow('8690000000002');
    expect(getCalls).toBe(1);
    await user.click(within(midRow).getByRole('button', { name: /Maliyet Ekle/ }));
    await user.click(await screen.findByRole('option', { name: /Paketleme/ }));

    await waitFor(() => expect(getCalls).toBe(2));
  });

  it('filters to cost-missing products when the "Maliyet bekleyen" tab is selected', async () => {
    server.use(http.get(URL, () => HttpResponse.json(response)));

    const { user } = render(
      <NuqsTestHarness>
        <LiveTodayProducts orgId={ORG_ID} storeId={STORE_ID} />
      </NuqsTestHarness>,
    );

    await waitFor(() => expect(screen.getByText('En Çok Satan')).toBeInTheDocument());

    await user.click(screen.getByRole('tab', { name: /Maliyet bekleyen/ }));

    // The costed products leave the table; the cost-missing ones stay.
    await waitFor(() => expect(screen.queryByText('En Çok Satan')).toBeNull());
    expect(screen.queryByText('En Düşük Ürün')).toBeNull();
    expect(screen.getByText('Orta Ürün')).toBeInTheDocument();
    expect(screen.getByText('Düşük Ürün')).toBeInTheDocument();
  });
});
