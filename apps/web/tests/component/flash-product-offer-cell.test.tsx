import { createTranslator } from 'next-intl';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FlashProductOfferCell } from '@/features/campaigns/components/flash-product-offer-cell';
import type { FlashBand, FlashProductRow } from '@/features/campaigns/lib/adapt-flash-product';
import { type CampaignAccess, UPLOAD_GATES } from '@/features/campaigns/lib/campaign-access';
import { CampaignAccessProvider } from '@/features/campaigns/lib/campaign-access-context';
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
const tSlot = createTranslator({
  locale: 'tr',
  messages: trMessages,
  namespace: 'flashProductsPage.slot',
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
const SLOT_LABEL = tSlot('h24');
const SELECT_OFFER = tTable('selectOffer', { slot: SLOT_LABEL });
const VS_CURRENT = tTable('vsCurrent');
const UNKNOWN_COMMISSION = `${tTable('offerCommission')} ${tTable('commissionUnknown')}`;
const UNKNOWN_COMMISSION_HINT = tTable('offerCommissionUnknownHint');
// The Turkish lira sign every formatted amount carries (tr-TR, TRY), and the em-dash an
// empty profit badge shows.
const TRY_SIGN = String.fromCodePoint(0x20ba);
const EM_DASH = String.fromCodePoint(0x2014);

const SCOPE = {
  orgId: '00000000-0000-0000-0000-000000000001',
  storeId: '00000000-0000-0000-0000-000000000002',
  // The Flash detail scope carries the LIST id under `tariffId` (the shared scope shape).
  tariffId: '00000000-0000-0000-0000-000000000003',
};

const ESTIMATE_URL = `http://localhost:3001/v1/organizations/${SCOPE.orgId}/stores/${SCOPE.storeId}/flash-products/${SCOPE.tariffId}/items/:itemId/estimate`;

// A 24-hour offer whose price lands in a commission tariff band.
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

// No commission tariff band covers the offer and the file's current commission could not
// be read: the backend sends the offer with no percent and no profit, and the row has no
// current profit (its only offer was never evaluated, so nothing is calculable and there
// is no reason).
const noCommissionOffer: FlashBand = {
  ...offer,
  commissionPct: null,
  netProfit: null,
  marginPct: null,
};
const noCommissionRow: FlashProductRow = {
  ...row,
  currentCommissionPct: null,
  currentNetProfit: null,
  currentMarginPct: null,
  calculable: false,
  reason: null,
  commissionSource: 'current',
  bands: [noCommissionOffer],
};

function renderCell(props: React.ComponentProps<typeof FlashProductOfferCell>) {
  return render(
    <TariffScopeProvider scope={SCOPE}>
      <FlashProductOfferCell {...props} />
    </TariffScopeProvider>,
  );
}

const READ_ONLY_ACCESS: CampaignAccess = { canWrite: false, upload: UPLOAD_GATES.HIDDEN };

/** Renders the cell for a member who cannot write. */
function renderReadOnlyCell(props: React.ComponentProps<typeof FlashProductOfferCell>) {
  return render(
    <CampaignAccessProvider value={READ_ONLY_ACCESS}>
      <TariffScopeProvider scope={SCOPE}>
        <FlashProductOfferCell {...props} />
      </TariffScopeProvider>
    </CampaignAccessProvider>,
  );
}

describe('FlashProductOfferCell', () => {
  it('prints the percent when it is known', () => {
    renderCell({ row, band: offer, slotLabel: SLOT_LABEL, selected: false, onSelect: vi.fn() });
    expect(screen.getByText(/800,00/)).toBeInTheDocument();
    expect(screen.getByText(/%13,1/)).toBeInTheDocument();
    expect(screen.queryByText(UNKNOWN_COMMISSION)).toBeNull();
    expect(screen.queryByText(UNKNOWN_COMMISSION_HINT)).toBeNull();
    // Control for the unknown-commission test below: a known offer has a profit.
    expect(screen.getByRole('button', { name: OPEN_LABEL })).toHaveTextContent(/10,00/);
  });

  describe('unknown commission', () => {
    it('shows the unknown commission with its caption and no profit', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(ESTIMATE_URL, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({
            itemId: row.id,
            price: '800.00',
            commissionPct: null,
            commissionSource: 'current',
            calculable: false,
            reason: null,
            breakdown: null,
          });
        }),
      );
      const { user } = renderCell({
        row: noCommissionRow,
        band: noCommissionOffer,
        slotLabel: SLOT_LABEL,
        selected: false,
        onSelect: vi.fn(),
      });
      const label = screen.getByText(UNKNOWN_COMMISSION);
      // The caption is a visible line under the label (it reads on touch too).
      const hint = screen.getByText(UNKNOWN_COMMISSION_HINT);
      expect(label.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.queryByRole('button', { name: INFO_HINT_LABEL })).toBeNull();
      // The flash price stays the hero; never a made-up percent.
      expect(screen.getByText(/800,00/)).toBeInTheDocument();
      expect(screen.queryByText(/%\d/)).toBeNull();
      // No profit: the badge is an empty em-dash, never an amount, and no delta.
      const badge = screen.getByRole('button', { name: OPEN_LABEL });
      expect(badge).toHaveTextContent(EM_DASH);
      expect(badge).not.toHaveTextContent(TRY_SIGN);
      expect(screen.queryByText(VS_CURRENT)).toBeNull();
      // The badge still asks the backend at the offer price; it answers "not calculable".
      await user.click(badge);
      const dialog = await screen.findByRole('dialog');
      await waitFor(() => expect(capturedBody).toEqual({ price: '800.00' }));
      expect(await within(dialog).findByText(NOT_CALCULABLE)).toBeInTheDocument();
    });

    it('can still be selected', async () => {
      const onSelect = vi.fn();
      const { user } = renderCell({
        row: noCommissionRow,
        band: noCommissionOffer,
        slotLabel: SLOT_LABEL,
        selected: false,
        onSelect,
      });
      // Nothing the export writes depends on the percent, so the select target stays.
      const toggle = screen.getByRole('button', { name: SELECT_OFFER });
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByText(tTable('selectOfferShort'))).toBeInTheDocument();
      await user.click(toggle);
      expect(onSelect).toHaveBeenCalledTimes(1);
    });
  });

  describe('read-only member', () => {
    it('offers no select target on an unselected offer but keeps the profit badge', () => {
      renderReadOnlyCell({
        row,
        band: offer,
        slotLabel: SLOT_LABEL,
        selected: false,
        onSelect: vi.fn(),
      });
      expect(screen.queryByRole('button', { name: SELECT_OFFER })).toBeNull();
      // The foot's label only invites a choice, so it is gone too.
      expect(screen.queryByText(tTable('selectOfferShort'))).toBeNull();
      // The offer itself still reads in full, and its breakdown stays reachable.
      expect(screen.getByText(/800,00/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: OPEN_LABEL })).toHaveTextContent(/10,00/);
    });

    it('shows a stored choice as text, with no button to change it', () => {
      renderReadOnlyCell({
        row,
        band: offer,
        slotLabel: SLOT_LABEL,
        selected: true,
        onSelect: vi.fn(),
      });
      expect(screen.getByText(tTable('offerSelected'))).toBeInTheDocument();
      // A selected overlay would be named by the selected label: neither name may exist.
      expect(screen.queryByRole('button', { name: tTable('offerSelected') })).toBeNull();
      expect(screen.queryByRole('button', { name: SELECT_OFFER })).toBeNull();
      expect(screen.getByRole('button', { name: OPEN_LABEL })).toBeInTheDocument();
    });
  });
});
