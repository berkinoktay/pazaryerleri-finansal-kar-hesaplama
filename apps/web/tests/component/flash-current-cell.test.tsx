import { createTranslator } from 'next-intl';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { FlashCurrentCell } from '@/features/campaigns/components/flash-current-cell';
import type { FlashBand, FlashProductRow } from '@/features/campaigns/lib/adapt-flash-product';
import { TariffScopeProvider } from '@/features/campaigns/lib/tariff-scope';

import { render, screen, waitFor, within } from '../helpers/render';
import { HttpResponse, http, server } from '../helpers/msw';
import trMessages from '../../messages/tr.json';

// Every expected string is built from the catalog, never typed.
const tTable = createTranslator({
  locale: 'tr',
  messages: trMessages,
  namespace: 'flashProductsPage.table',
});
const tBadge = createTranslator({ locale: 'tr', messages: trMessages, namespace: 'profitBadge' });
const tBreakdown = createTranslator({
  locale: 'tr',
  messages: trMessages,
  namespace: 'profitBreakdown',
});
const tCommon = createTranslator({ locale: 'tr', messages: trMessages, namespace: 'common' });

const OPEN_LABEL = tBadge('open');
const INFO_HINT_LABEL = tCommon('infoHint');
const NOT_CALCULABLE = tBreakdown('notCalculable');
const UNKNOWN_COMMISSION = `${tTable('offerCommission')} ${tTable('commissionUnknown')}`;
const UNKNOWN_COMMISSION_HINT = tTable('commissionUnknownHint');

const SCOPE = {
  orgId: '00000000-0000-0000-0000-000000000001',
  storeId: '00000000-0000-0000-0000-000000000002',
  // The Flash detail scope carries the LIST id under `tariffId` (the shared scope shape).
  tariffId: '00000000-0000-0000-0000-000000000003',
};

const ESTIMATE_URL = `http://localhost:3001/v1/organizations/${SCOPE.orgId}/stores/${SCOPE.storeId}/flash-products/${SCOPE.tariffId}/items/:itemId/estimate`;

const offer: FlashBand = {
  key: 'h24',
  price: '800.00',
  commissionPct: '13.10',
  netProfit: '10.00',
  marginPct: '2.00',
  startsAt: '2026-07-08T00:00:00Z',
  endsAt: '2026-07-08T23:59:00Z',
  validity: 'active',
};

// A calculable row whose customer price (the price the buyer sees) differs from its list
// price, so the hero is identifiable.
const row: FlashProductRow = {
  id: 'r1',
  barcode: '123',
  modelCode: 'M1',
  productTitle: 'Test Product',
  imageUrl: null,
  category: 'Flag',
  brand: 'Brand',
  stock: null,
  currentPrice: '900.00',
  customerPrice: '880.00',
  currentCommissionPct: '19',
  currentNetProfit: '50.00',
  currentMarginPct: '6.25',
  calculable: true,
  reason: null,
  hasCommissionTariff: true,
  commissionSource: 'band',
  commissionBands: null,
  selectedOffer: null,
  customPrice: null,
  bands: [offer],
  flashDay: '2026-07-08T00:00:00Z',
};

// The file's current commission could not be read: the price is known, but the backend
// has no current profit or margin.
const unknownCommissionRow: FlashProductRow = {
  ...row,
  currentCommissionPct: null,
  currentNetProfit: null,
  currentMarginPct: null,
};

function renderCell(props: React.ComponentProps<typeof FlashCurrentCell>) {
  return render(
    <TariffScopeProvider scope={SCOPE}>
      <FlashCurrentCell {...props} />
    </TariffScopeProvider>,
  );
}

describe('FlashCurrentCell', () => {
  it('shows the customer price, the commission and the profit badge when the commission is known', () => {
    renderCell({ row });
    expect(screen.getByText(/880,00/)).toBeInTheDocument();
    expect(screen.queryByText(/900,00/)).toBeNull();
    expect(screen.getByText(/%19/)).toBeInTheDocument();
    expect(screen.queryByText(UNKNOWN_COMMISSION)).toBeNull();
    expect(screen.queryByText(UNKNOWN_COMMISSION_HINT)).toBeNull();
    expect(screen.getByRole('button', { name: OPEN_LABEL })).toHaveTextContent(/50,00/);
  });

  it("opens the breakdown with a scenario:'current' estimate request when the commission is known", async () => {
    let capturedBody: unknown;
    server.use(
      http.post(ESTIMATE_URL, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          itemId: row.id,
          price: '880.00',
          commissionPct: '19',
          commissionSource: 'current',
          calculable: true,
          reason: null,
          breakdown: null,
        });
      }),
    );
    const { user } = renderCell({ row });
    await user.click(screen.getByRole('button', { name: OPEN_LABEL }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(capturedBody).toEqual({ scenario: 'current' }));
  });

  describe('unknown commission', () => {
    it('shows the unknown commission and its caption, and still shows the price', () => {
      renderCell({ row: unknownCommissionRow });
      const label = screen.getByText(UNKNOWN_COMMISSION);
      // The caption is a visible line under the label (it reads on touch too).
      const hint = screen.getByText(UNKNOWN_COMMISSION_HINT);
      expect(label.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.queryByRole('button', { name: INFO_HINT_LABEL })).toBeNull();
      // The price stays the hero.
      expect(screen.getByText(/880,00/)).toBeInTheDocument();
      // Never a made-up percent.
      expect(screen.queryByText(/%\d/)).toBeNull();
    });

    it('opens the not-calculable dialog without an estimate request when the current commission is unknown', async () => {
      let requests = 0;
      server.use(
        http.post(ESTIMATE_URL, () => {
          requests += 1;
          return HttpResponse.json({
            itemId: row.id,
            price: '880.00',
            commissionPct: null,
            commissionSource: 'current',
            calculable: false,
            reason: null,
            breakdown: null,
          });
        }),
      );
      const { user } = renderCell({ row: unknownCommissionRow });
      await user.click(screen.getByRole('button', { name: OPEN_LABEL }));
      const dialog = await screen.findByRole('dialog');
      expect(await within(dialog).findByText(NOT_CALCULABLE)).toBeInTheDocument();
      expect(requests).toBe(0);
    });
  });
});
