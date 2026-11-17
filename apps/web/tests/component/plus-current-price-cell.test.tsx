import { createTranslator } from 'next-intl';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { PlusCurrentPriceCell } from '@/features/campaigns/components/plus-current-price-cell';
import type { PlusTariffRow } from '@/features/campaigns/lib/adapt-plus-tariff';
import { TariffScopeProvider } from '@/features/campaigns/lib/tariff-scope';

import { render, screen, waitFor, within } from '../helpers/render';
import { HttpResponse, http, server } from '../helpers/msw';
import trMessages from '../../messages/tr.json';

// Every expected string is built from the catalog, never typed.
const tTable = createTranslator({
  locale: 'tr',
  messages: trMessages,
  namespace: 'plusCommissionTariffsPage.table',
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
const PRICE_UNKNOWN = tTable('priceUnknown');
const PRICE_UNKNOWN_HINT = tTable('priceUnknownHint');
const NOT_CALCULABLE = tBreakdown('notCalculable');
// The Turkish lira sign every formatted amount carries (tr-TR, TRY).
const TRY_SIGN = String.fromCodePoint(0x20ba);

const SCOPE = {
  orgId: '00000000-0000-0000-0000-000000000001',
  storeId: '00000000-0000-0000-0000-000000000002',
  tariffId: '00000000-0000-0000-0000-000000000003',
};

const ESTIMATE_URL = `http://localhost:3001/v1/organizations/${SCOPE.orgId}/stores/${SCOPE.storeId}/plus-commission-tariffs/${SCOPE.tariffId}/items/:itemId/estimate`;

// A calculable row whose commission-base price (the price the buyer sees) differs from
// its raw sale price, so the "which price is the hero" behaviour is testable.
const row: PlusTariffRow = {
  id: 'r1',
  barcode: '123',
  stockCode: 'M1',
  productTitle: 'Test Product',
  imageUrl: null,
  category: 'Flag',
  brand: 'Brand',
  currentPrice: '800.00',
  commissionBasePrice: '780.00',
  currentCommissionPct: '19',
  currentNetProfit: '50.00',
  currentMarginPct: '6.25',
  plusIsBetter: false,
  calculable: true,
  reason: null,
  selected: false,
  customPrice: null,
  bands: [
    { key: 'plus', price: '777.09', commissionPct: '13.1', netProfit: '40.00', marginPct: '5.1' },
  ],
};

// Neither the current price nor the commission-base price could be read: the backend has
// no baseline, so the current profit and margin are null too.
const unknownRow: PlusTariffRow = {
  ...row,
  currentPrice: null,
  commissionBasePrice: null,
  currentNetProfit: null,
  currentMarginPct: null,
  calculable: false,
};

function renderCell(props: React.ComponentProps<typeof PlusCurrentPriceCell>) {
  return render(
    <TariffScopeProvider scope={SCOPE}>
      <PlusCurrentPriceCell {...props} />
    </TariffScopeProvider>,
  );
}

describe('PlusCurrentPriceCell', () => {
  it('shows the commission base price as the hero when it is known', () => {
    renderCell({ row });
    expect(screen.getByText(/780,00/)).toBeInTheDocument();
    expect(screen.queryByText(/800,00/)).toBeNull();
    expect(screen.queryByText(PRICE_UNKNOWN)).toBeNull();
    // Control for the unknown-price test below: a known price carries the lira sign.
    expect(screen.getAllByText(new RegExp(TRY_SIGN)).length).toBeGreaterThan(0);
  });

  it("opens the breakdown with a scenario:'current' estimate request when the price is known", async () => {
    let capturedBody: unknown;
    server.use(
      http.post(ESTIMATE_URL, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          itemId: row.id,
          price: '780.00',
          commissionPct: '19',
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

  describe('unknown price', () => {
    it('shows the unknown label and its caption, and no currency amount, when neither baseline price is known', () => {
      renderCell({ row: unknownRow });
      expect(screen.getByText(PRICE_UNKNOWN)).toBeInTheDocument();
      // Never a made-up amount anywhere in the cell (the row's profits are null too):
      // no TRY currency mark at all.
      expect(screen.queryByText(new RegExp(TRY_SIGN))).toBeNull();
      // The commission line and the (empty) profit badge stay.
      expect(screen.getByText(/%19/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: OPEN_LABEL })).toBeInTheDocument();
      // The caption is a visible line under the label (it reads on touch too), not a
      // hover-only hint.
      const hint = screen.getByText(PRICE_UNKNOWN_HINT);
      expect(
        screen.getByText(PRICE_UNKNOWN).compareDocumentPosition(hint) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(screen.queryByRole('button', { name: INFO_HINT_LABEL })).toBeNull();
    });

    it('shows the current price when only the commission base price is unknown', () => {
      renderCell({ row: { ...row, commissionBasePrice: null } });
      expect(screen.getByText(/800,00/)).toBeInTheDocument();
      expect(screen.queryByText(/780,00/)).toBeNull();
      expect(screen.queryByText(PRICE_UNKNOWN)).toBeNull();
      expect(screen.queryByText(PRICE_UNKNOWN_HINT)).toBeNull();
    });

    it('opens the not-calculable dialog without an estimate request when the price is unknown', async () => {
      let requests = 0;
      server.use(
        http.post(ESTIMATE_URL, () => {
          requests += 1;
          return HttpResponse.json({
            itemId: row.id,
            price: '0.00',
            commissionPct: '19',
            calculable: false,
            reason: null,
            breakdown: null,
          });
        }),
      );
      const { user } = renderCell({ row: unknownRow });
      await user.click(screen.getByRole('button', { name: OPEN_LABEL }));
      const dialog = await screen.findByRole('dialog');
      expect(await within(dialog).findByText(NOT_CALCULABLE)).toBeInTheDocument();
      expect(requests).toBe(0);
    });
  });

  describe('unknown commission', () => {
    // The file's current commission could not be read: the price is known, but the
    // backend has no current profit or margin.
    const unknownCommissionRow: PlusTariffRow = {
      ...row,
      currentCommissionPct: null,
      currentNetProfit: null,
      currentMarginPct: null,
    };
    const UNKNOWN_COMMISSION = `${tTable('currentCommission')} ${tTable('commissionUnknown')}`;
    const UNKNOWN_COMMISSION_HINT = tTable('commissionUnknownHint');

    it('shows the unknown commission and its caption, and still shows the price', () => {
      renderCell({ row: unknownCommissionRow });
      const label = screen.getByText(UNKNOWN_COMMISSION);
      // The caption is a visible line under the label (it reads on touch too).
      const hint = screen.getByText(UNKNOWN_COMMISSION_HINT);
      expect(label.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.queryByRole('button', { name: INFO_HINT_LABEL })).toBeNull();
      // The price stays the hero; the unknown-price wording is not used for it.
      expect(screen.getByText(/780,00/)).toBeInTheDocument();
      expect(screen.queryByText(PRICE_UNKNOWN)).toBeNull();
      expect(screen.queryByText(PRICE_UNKNOWN_HINT)).toBeNull();
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
            price: '780.00',
            commissionPct: '0',
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
