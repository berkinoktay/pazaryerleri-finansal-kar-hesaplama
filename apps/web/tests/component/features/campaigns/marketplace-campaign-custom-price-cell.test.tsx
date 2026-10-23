import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { formatCurrency } from '@pazarsync/utils';

import { MarketplaceCampaignCustomPriceCell } from '@/features/campaigns/components/marketplace-campaign-custom-price-cell';
import type {
  CampaignScenario,
  CampaignScenarioPresentation,
  MarketplaceCampaignRow,
} from '@/features/campaigns/lib/adapt-marketplace-campaign';
import {
  applyCustomPrice,
  seedCampaignChoices,
  toggleCampaignChoice,
  type CampaignChoiceState,
} from '@/features/campaigns/lib/marketplace-campaign-selection';
import { TariffScopeProvider } from '@/features/campaigns/lib/tariff-scope';

import trMessages from '../../../../messages/tr.json';
import { HttpResponse, http, server } from '../../../helpers/msw';
import { render, screen, waitFor } from '../../../helpers/render';

const TABLE = trMessages.marketplaceCampaignsPage.table;
const PROFIT_BADGE_LABEL = /kâr detayını gör/i;

const SCOPE = {
  orgId: '00000000-0000-0000-0000-000000000001',
  storeId: '00000000-0000-0000-0000-000000000002',
  // The Kampanyalar detail scope carries the CAMPAIGN id under `tariffId` (the shared shape).
  tariffId: '00000000-0000-0000-0000-000000000003',
};
const BASE = `http://localhost:3001/v1/organizations/${SCOPE.orgId}/stores/${SCOPE.storeId}/marketplace-campaigns/${SCOPE.tariffId}`;
const ESTIMATE_URL = `${BASE}/items/:itemId/estimate`;
const SELECTIONS_URL = `${BASE}/selections`;
// Comfortably past the cell's 400ms debounce.
const PAST_DEBOUNCE_MS = 600;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function scenario(price: string, netProfit: string | null): CampaignScenario {
  return {
    price,
    commissionPct: '18.0000',
    commissionSource: 'product',
    netProfit,
    marginPct: netProfit,
  };
}

/** A calculable row: maximum 200 (the custom ceiling), no custom price saved yet. */
function makeRow(over: Partial<MarketplaceCampaignRow> = {}): MarketplaceCampaignRow {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    barcode: '8681234567890',
    productCode: null,
    externalId: null,
    productTitle: 'Kampanya Ürünü',
    brand: null,
    color: null,
    size: null,
    category: null,
    stock: null,
    imageUrl: null,
    currentPrice: '250.00',
    maxPrice: '200.00',
    hasCommissionTariff: false,
    selection: 'NONE',
    customPrice: null,
    calculable: true,
    reason: null,
    current: scenario('250.00', '60.00'),
    maxScenario: scenario('200.00', '30.00'),
    customScenario: null,
    commissionBands: null,
    maxBasket: null,
    customBasket: null,
    ...over,
  };
}

/** The what-if answer the backend gives for a custom price (overridable per test). */
function estimateResult(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    itemId: makeRow().id,
    scenario: 'custom',
    price: '150.00',
    customerPaidUnitPrice: '150.00',
    trendyolFundedUnitAmount: '0.00',
    commissionPct: '18.0000',
    commissionSource: 'product',
    calculable: true,
    reason: null,
    breakdown: { netProfit: '12.00', saleMarginPct: '8.00' },
    breakdownScope: 'unit',
    basket: null,
    commissionTariffName: null,
    commissionPeriodLabel: null,
    ...over,
  };
}

/** Records every estimate request body and answers with `result`. */
function trackEstimates(result: Record<string, unknown> = estimateResult()): unknown[] {
  const bodies: unknown[] = [];
  server.use(
    http.post(ESTIMATE_URL, async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json(result);
    }),
  );
  return bodies;
}

/**
 * Wires the controlled cell to the REAL buffer functions, the way the detail client does: the
 * typed price and the choice live in local state, nothing else.
 */
function Harness({
  row,
  presentation,
}: {
  row: MarketplaceCampaignRow;
  presentation: CampaignScenarioPresentation;
}): React.ReactElement {
  const [state, setState] = React.useState<CampaignChoiceState>(() => seedCampaignChoices([row]));
  return (
    <TariffScopeProvider scope={SCOPE}>
      <MarketplaceCampaignCustomPriceCell
        row={row}
        presentation={presentation}
        price={state.customPrices[row.id] ?? null}
        selected={state.selection[row.id] === 'CUSTOM'}
        onPriceChange={(target, price) => setState((prev) => applyCustomPrice(prev, target, price))}
        onToggle={() => setState((prev) => toggleCampaignChoice(prev, row, 'CUSTOM'))}
      />
    </TariffScopeProvider>
  );
}

function renderCell(
  row: MarketplaceCampaignRow = makeRow(),
  presentation: CampaignScenarioPresentation = 'UNIT',
) {
  return render(<Harness row={row} presentation={presentation} />);
}

const priceInput = (row: MarketplaceCampaignRow = makeRow()): HTMLElement =>
  screen.getByRole('textbox', {
    name: TABLE.customPriceAria.replace('{product}', row.productTitle),
  });

describe('MarketplaceCampaignCustomPriceCell', () => {
  it('flags a price above the maximum inline, keeps it unselectable and asks for no estimate', async () => {
    const estimates = trackEstimates();
    const { user } = renderCell();

    // Unlike a silently refused keystroke, the over-ceiling price IS taken and explained.
    await user.type(priceInput(), '250');

    expect(
      await screen.findByText(
        TABLE.customPriceAboveMax.replace('{price}', formatCurrency('200.00')),
      ),
    ).toBeInTheDocument();
    expect(priceInput()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: TABLE.selectPrice })).toBeDisabled();
    await wait(PAST_DEBOUNCE_MS);
    expect(estimates).toHaveLength(0);
  });

  it('estimates a valid new price once, after the seller stops typing', async () => {
    const estimates = trackEstimates();
    const { user } = renderCell();

    await user.type(priceInput(), '150');

    await waitFor(() => expect(estimates).toHaveLength(1));
    expect(estimates[0]).toEqual({ scenario: 'custom', customPrice: '150.00' });
    expect(await screen.findByRole('button', { name: PROFIT_BADGE_LABEL })).toHaveTextContent(
      '12,00',
    );
    // The keystrokes before "150" were debounced away — no second request follows.
    await wait(PAST_DEBOUNCE_MS);
    expect(estimates).toHaveLength(1);
  });

  it('choosing the price only updates the local buffer — no request goes out', async () => {
    let selectionWrites = 0;
    server.use(
      http.patch(SELECTIONS_URL, () => {
        selectionWrites += 1;
        return HttpResponse.json({ updated: 1 });
      }),
    );
    const estimates = trackEstimates();
    // A SAVED custom price already carries its figures on the row — nothing to estimate.
    const { user } = renderCell(
      makeRow({ customPrice: '150.00', customScenario: scenario('150.00', '12.00') }),
    );

    await user.click(screen.getByRole('button', { name: TABLE.selectPrice }));

    expect(screen.getByRole('button', { name: TABLE.selected })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await wait(PAST_DEBOUNCE_MS);
    expect(selectionWrites).toBe(0);
    expect(estimates).toHaveLength(0);
  });

  it('clearing the price of a joined row takes the row out of the campaign', async () => {
    const row = makeRow({
      selection: 'CUSTOM',
      customPrice: '150.00',
      customScenario: scenario('150.00', '12.00'),
    });
    const { user } = renderCell(row);
    expect(screen.getByRole('button', { name: TABLE.selected })).toBeInTheDocument();

    await user.clear(priceInput(row));

    const select = screen.getByRole('button', { name: TABLE.selectPrice });
    expect(select).toHaveAttribute('aria-pressed', 'false');
    expect(select).toBeDisabled();
  });

  it("on an ORDER row the card headlines the typed price's own order", async () => {
    trackEstimates(
      estimateResult({
        breakdownScope: 'order',
        price: '450.00',
        customerPaidUnitPrice: null,
        trendyolFundedUnitAmount: null,
        breakdown: { netProfit: '28.00', saleMarginPct: '6.22' },
        basket: {
          assumedQuantity: 3,
          basketTotal: '450.00',
          basketPaidTotal: '300.00',
          basketDiscountTotal: '150.00',
          trendyolFundedTotal: '0.00',
          orderNetProfit: '28.00',
          orderMarginPct: '6.22',
          currentOrderNetProfit: '90.00',
        },
      }),
    );
    const { user } = renderCell(makeRow(), 'ORDER');

    await user.type(priceInput(), '150');

    expect(await screen.findByText(TABLE.orderQuantity.replace('{qty}', '3'))).toBeInTheDocument();
    expect(
      screen.getByText(TABLE.customerPays.replace('{amount}', formatCurrency('300.00'))),
    ).toBeInTheDocument();
    expect(screen.getByText(TABLE.orderProfit)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: PROFIT_BADGE_LABEL })).toHaveTextContent('28,00');
  });
});
