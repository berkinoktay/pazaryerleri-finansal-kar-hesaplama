import { describe, expect, it } from 'vitest';

import { LiveMissingCostCard } from '@/features/live-performance/components/live-missing-cost-card';

import { render, screen, waitFor } from '../../../helpers/render';
import { server, http, HttpResponse } from '../../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const STORE_ID = '00000000-0000-0000-0000-000000000002';
const URL = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/live-performance/missing-cost`;

describe('LiveMissingCostCard', () => {
  it('renders a labeled table row with copyable identifiers and the inline add-cost trigger', async () => {
    server.use(
      http.get(URL, () =>
        HttpResponse.json({
          data: [
            {
              variantId: 'v-1',
              barcode: '8690000000001',
              stockCode: 'STK-KAZAK-01',
              productName: 'X Marka Kazak',
              thumbUrl: null,
              orderCount: 3,
              revenueImpact: '750.00',
            },
          ],
        }),
      ),
    );

    render(<LiveMissingCostCard orgId={ORG_ID} storeId={STORE_ID} />);

    await waitFor(() => expect(screen.getByText('X Marka Kazak')).toBeInTheDocument());
    // Column headers label every value — including the previously-unlabeled amount.
    expect(screen.getByRole('columnheader', { name: 'Stok Kodu' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Barkod' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Bekleyen ciro/ })).toBeInTheDocument();
    // Both identifiers are one-click copyable (CopyableValue wraps each in a button).
    expect(screen.getByRole('button', { name: 'Stok Kodu kopyala' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Barkod kopyala' })).toBeInTheDocument();
    expect(screen.getByText('STK-KAZAK-01')).toBeInTheDocument();
    // The inline cost-attach trigger (reused CostCellPopover) is present per row.
    expect(screen.getAllByRole('button', { name: 'Maliyet Ekle' })).toHaveLength(1);
    // The waiting-orders warning is announced as a status region.
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows the success empty state when nothing is missing cost', async () => {
    server.use(http.get(URL, () => HttpResponse.json({ data: [] })));

    render(<LiveMissingCostCard orgId={ORG_ID} storeId={STORE_ID} />);

    await waitFor(() => expect(screen.getByText('Bugün eksik maliyet yok')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Maliyet Ekle' })).toBeNull();
  });
});
