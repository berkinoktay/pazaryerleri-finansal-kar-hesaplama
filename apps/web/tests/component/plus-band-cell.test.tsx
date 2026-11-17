import { createTranslator } from 'next-intl';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PlusBandCell } from '@/features/campaigns/components/plus-band-cell';
import type { PlusBand, PlusTariffRow } from '@/features/campaigns/lib/adapt-plus-tariff';
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
const NOT_CALCULABLE = tBreakdown('notCalculable');
const PRICE_UNKNOWN = tTable('priceUnknown');
const PLUS_PRICE_UNKNOWN_HINT = tTable('plusPriceUnknownHint');
const NOT_SELECTABLE = tTable('notSelectable');
const CEILING_QUALIFIER = tTable('ceilingQualifier');
const JOIN = tTable('join');
const JOINED = tTable('joined');
const BEST = tTable('best');
// The Turkish lira sign every formatted amount carries (tr-TR, TRY).
const TRY_SIGN = String.fromCodePoint(0x20ba);

const SCOPE = {
  orgId: '00000000-0000-0000-0000-000000000001',
  storeId: '00000000-0000-0000-0000-000000000002',
  tariffId: '00000000-0000-0000-0000-000000000003',
};

const ESTIMATE_URL = `http://localhost:3001/v1/organizations/${SCOPE.orgId}/stores/${SCOPE.storeId}/plus-commission-tariffs/${SCOPE.tariffId}/items/:itemId/estimate`;

// The Plus offer at a known ceiling.
const offer: PlusBand = {
  key: 'plus',
  price: '777.09',
  commissionPct: '13.1',
  netProfit: '70.79',
  marginPct: '9.11',
};

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
  plusIsBetter: true,
  calculable: true,
  reason: null,
  selected: false,
  customPrice: null,
  bands: [offer],
};

// The file's Plus price upper limit could not be read: the backend sends a null ceiling
// and no profit for the offer, and the row's Plus option is never better.
const noPriceOffer: PlusBand = { ...offer, price: null, netProfit: null, marginPct: null };
const unknownRow: PlusTariffRow = { ...row, plusIsBetter: false, bands: [noPriceOffer] };

function renderCell(props: React.ComponentProps<typeof PlusBandCell>) {
  return render(
    <TariffScopeProvider scope={SCOPE}>
      <PlusBandCell {...props} />
    </TariffScopeProvider>,
  );
}

describe('PlusBandCell', () => {
  it('joins on click when the ceiling is known', async () => {
    const onSelect = vi.fn();
    const { user } = renderCell({ row, band: offer, selected: false, onSelect });
    // The ceiling price is the hero, with its qualifier; no unknown label.
    expect(screen.getByText(/777,09/)).toBeInTheDocument();
    expect(screen.getByText(CEILING_QUALIFIER)).toBeInTheDocument();
    expect(screen.queryByText(PRICE_UNKNOWN)).toBeNull();
    // Control for the unknown-ceiling test below: a known price carries the lira sign.
    expect(screen.getAllByText(new RegExp(TRY_SIGN)).length).toBeGreaterThan(0);
    const toggle = screen.getByRole('button', { name: JOIN });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('estimates at the ceiling when the badge of a priced offer is clicked', async () => {
    let capturedBody: unknown;
    server.use(
      http.post(ESTIMATE_URL, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          itemId: row.id,
          price: '777.09',
          commissionPct: '13.1',
          calculable: true,
          reason: null,
          breakdown: null,
        });
      }),
    );
    const onSelect = vi.fn();
    const { user } = renderCell({ row, band: offer, selected: false, onSelect });
    await user.click(screen.getByRole('button', { name: OPEN_LABEL }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(capturedBody).toEqual({ price: '777.09' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows the best ribbon on an offer with a price that wins the row', () => {
    renderCell({ row, band: offer, selected: false, isBest: true, onSelect: vi.fn() });
    expect(screen.getByText(BEST)).toBeInTheDocument();
  });

  describe('unknown ceiling', () => {
    it('shows the unknown label with its caption and cannot be joined when the ceiling is unknown', async () => {
      const onSelect = vi.fn();
      const { user } = renderCell({
        row: unknownRow,
        band: noPriceOffer,
        selected: false,
        onSelect,
      });
      expect(screen.getByText(PRICE_UNKNOWN)).toBeInTheDocument();
      // Never a made-up amount (no lira sign anywhere), and no "and below" qualifier
      // without a price.
      expect(screen.queryByText(new RegExp(TRY_SIGN))).toBeNull();
      expect(screen.queryByText(CEILING_QUALIFIER)).toBeNull();
      // The caption is a visible line under the label (it reads on touch too), not a
      // hover-only hint.
      const hint = screen.getByText(PLUS_PRICE_UNKNOWN_HINT);
      expect(
        screen.getByText(PRICE_UNKNOWN).compareDocumentPosition(hint) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(screen.queryByRole('button', { name: INFO_HINT_LABEL })).toBeNull();
      // No join target; the foot says it cannot be selected.
      expect(screen.queryByRole('button', { name: JOIN })).toBeNull();
      expect(screen.queryByText(JOIN)).toBeNull();
      expect(screen.getByText(NOT_SELECTABLE)).toBeInTheDocument();
      await user.click(screen.getByText(PRICE_UNKNOWN));
      await user.click(screen.getByText(NOT_SELECTABLE));
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('can still be un-joined when a card with an unknown ceiling is joined', async () => {
      const onSelect = vi.fn();
      const { user } = renderCell({
        row: { ...unknownRow, selected: true },
        band: noPriceOffer,
        selected: true,
        onSelect,
      });
      const toggle = screen.getByRole('button', { name: JOINED });
      expect(toggle).toHaveAttribute('aria-pressed', 'true');
      expect(screen.queryByText(NOT_SELECTABLE)).toBeNull();
      await user.click(toggle);
      expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('sends no estimate request for an offer with no price', async () => {
      let requests = 0;
      server.use(
        http.post(ESTIMATE_URL, () => {
          requests += 1;
          return HttpResponse.json({
            itemId: row.id,
            price: '0.00',
            commissionPct: '13.1',
            calculable: false,
            reason: null,
            breakdown: null,
          });
        }),
      );
      const onSelect = vi.fn();
      const { user } = renderCell({
        row: unknownRow,
        band: noPriceOffer,
        selected: false,
        onSelect,
      });
      await user.click(screen.getByRole('button', { name: OPEN_LABEL }));
      const dialog = await screen.findByRole('dialog');
      expect(await within(dialog).findByText(NOT_CALCULABLE)).toBeInTheDocument();
      expect(requests).toBe(0);
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('never shows the best ribbon on an offer with no price', () => {
      // Even a caller that marks it best gets no ribbon: an offer with no price never wins.
      renderCell({
        row: unknownRow,
        band: noPriceOffer,
        selected: false,
        isBest: true,
        onSelect: vi.fn(),
      });
      expect(screen.queryByText(BEST)).toBeNull();
    });
  });

  describe('unknown Plus commission', () => {
    // The file's Plus commission offer could not be read: the ceiling is known, but the
    // backend sends no percent and no profit, and the offer is never better.
    const noCommissionOffer: PlusBand = {
      ...offer,
      commissionPct: null,
      netProfit: null,
      marginPct: null,
    };
    const noCommissionRow: PlusTariffRow = {
      ...row,
      plusIsBetter: false,
      bands: [noCommissionOffer],
    };
    const UNKNOWN_COMMISSION = `${tTable('plusCommission')} ${tTable('commissionUnknown')}`;
    const UNKNOWN_COMMISSION_HINT = tTable('plusCommissionUnknownHint');

    it('shows the unknown commission with its caption and cannot be joined', async () => {
      const onSelect = vi.fn();
      const { user } = renderCell({
        row: noCommissionRow,
        band: noCommissionOffer,
        selected: false,
        onSelect,
      });
      const label = screen.getByText(UNKNOWN_COMMISSION);
      // The caption is a visible line under the label (it reads on touch too).
      const hint = screen.getByText(UNKNOWN_COMMISSION_HINT);
      expect(label.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.queryByRole('button', { name: INFO_HINT_LABEL })).toBeNull();
      // The ceiling price stays the hero; never a made-up percent.
      expect(screen.getByText(/777,09/)).toBeInTheDocument();
      expect(screen.queryByText(/%\d/)).toBeNull();
      // No join target; the foot says it cannot be selected.
      expect(screen.queryByRole('button', { name: JOIN })).toBeNull();
      expect(screen.queryByText(JOIN)).toBeNull();
      expect(screen.getByText(NOT_SELECTABLE)).toBeInTheDocument();
      await user.click(screen.getByText(UNKNOWN_COMMISSION));
      await user.click(screen.getByText(NOT_SELECTABLE));
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('shows only the commission caption when the price and the commission are unknown', () => {
      const bothUnknown: PlusBand = { ...noCommissionOffer, price: null };
      renderCell({
        row: { ...noCommissionRow, bands: [bothUnknown] },
        band: bothUnknown,
        selected: false,
        onSelect: vi.fn(),
      });
      expect(screen.getByText(PRICE_UNKNOWN)).toBeInTheDocument();
      // The price caption offers a custom price as the way out; with the commission
      // unknown a custom price cannot join either, so it is left out.
      expect(screen.queryByText(PLUS_PRICE_UNKNOWN_HINT)).toBeNull();
      expect(screen.getByText(UNKNOWN_COMMISSION)).toBeInTheDocument();
      expect(screen.getByText(UNKNOWN_COMMISSION_HINT)).toBeInTheDocument();
      expect(screen.getByText(NOT_SELECTABLE)).toBeInTheDocument();
    });

    it('can still be un-joined when already joined', async () => {
      const onSelect = vi.fn();
      const { user } = renderCell({
        row: { ...noCommissionRow, selected: true },
        band: noCommissionOffer,
        selected: true,
        onSelect,
      });
      const toggle = screen.getByRole('button', { name: JOINED });
      expect(toggle).toHaveAttribute('aria-pressed', 'true');
      expect(screen.queryByText(NOT_SELECTABLE)).toBeNull();
      await user.click(toggle);
      expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('sends no estimate request', async () => {
      let requests = 0;
      server.use(
        http.post(ESTIMATE_URL, () => {
          requests += 1;
          return HttpResponse.json({
            itemId: row.id,
            price: '777.09',
            commissionPct: '0',
            calculable: false,
            reason: null,
            breakdown: null,
          });
        }),
      );
      const onSelect = vi.fn();
      // The ceiling is known, so only the unknown commission keeps the request out.
      const { user } = renderCell({
        row: noCommissionRow,
        band: noCommissionOffer,
        selected: false,
        onSelect,
      });
      await user.click(screen.getByRole('button', { name: OPEN_LABEL }));
      const dialog = await screen.findByRole('dialog');
      expect(await within(dialog).findByText(NOT_CALCULABLE)).toBeInTheDocument();
      expect(requests).toBe(0);
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('never shows the best ribbon', () => {
      // Even a caller that marks it best gets no ribbon.
      renderCell({
        row: noCommissionRow,
        band: noCommissionOffer,
        selected: false,
        isBest: true,
        onSelect: vi.fn(),
      });
      expect(screen.queryByText(BEST)).toBeNull();
    });
  });
});
