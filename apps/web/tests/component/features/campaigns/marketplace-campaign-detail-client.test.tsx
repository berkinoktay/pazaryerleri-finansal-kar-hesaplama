import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `@/i18n/navigation` pulls in next-intl's client navigation, which resolves `next/navigation`
// (unavailable under vitest). Stub the two symbols the detail client uses.
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { formatCurrency } from '@pazarsync/utils';

import { MarketplaceCampaignDetailClient } from '@/features/campaigns/components/marketplace-campaign-detail-client';

import trMessages from '../../../../messages/tr.json';
import { HttpResponse, http, server } from '../../../helpers/msw';
import { render, screen, waitFor } from '../../../helpers/render';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const CAMPAIGN_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ITEM_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const BASE = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/marketplace-campaigns/${CAMPAIGN_ID}`;
const SELECTIONS_URL = `${BASE}/selections`;
const EXPORT_URL = `${BASE}/export`;
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLSX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

const TABLE = trMessages.marketplaceCampaignsPage.table;
const SAVE_AND_DOWNLOAD = trMessages.marketplaceCampaignsPage.actions.saveAndDownload;
const PRODUCT = 'Kampanya Ürünü';

function scenario(price: string, netProfit: string) {
  return {
    price,
    commissionPct: '18.0000',
    commissionSource: 'product',
    netProfit,
    marginPct: '10.00',
  };
}

function basket(paidTotal: string, orderNetProfit: string) {
  return {
    assumedQuantity: 2,
    basketTotal: paidTotal,
    basketPaidTotal: paidTotal,
    basketDiscountTotal: '0.00',
    trendyolFundedTotal: '0.00',
    orderNetProfit,
    orderMarginPct: '10.00',
    currentOrderNetProfit: '90.00',
  };
}

/**
 * A 2-al-1-öde campaign (ORDER presentation). The one product is saved on MAX but keeps a typed
 * custom price of 180, so BOTH options carry their own basket block.
 */
function detailResponse(selection: 'NONE' | 'MAX' = 'MAX') {
  return {
    id: CAMPAIGN_ID,
    name: 'Ağustos Kampanyası',
    discountType: 'BUY_X_PAY_Y',
    valueKind: null,
    value: null,
    minBasketAmount: null,
    minQuantity: null,
    buyQuantity: 2,
    payQuantity: 1,
    nthIndex: null,
    trendyolFundingPct: '0.00',
    startsAt: '2026-08-01T07:00:00.000Z',
    endsAt: '2026-08-07T20:59:00.000Z',
    exported: false,
    commissionTariffName: null,
    commissionPeriodLabel: null,
    commissionTariffOutdated: false,
    scenarioPresentation: 'ORDER',
    items: [
      {
        id: ITEM_ID,
        barcode: '8681234567890',
        productCode: 'MODEL-1',
        externalId: null,
        productTitle: PRODUCT,
        brand: 'Marka',
        color: null,
        size: null,
        category: null,
        stock: 10,
        imageUrl: null,
        currentPrice: '250.00',
        maxPrice: '200.00',
        hasCommissionTariff: false,
        selection,
        customPrice: '180.00',
        calculable: true,
        reason: null,
        current: scenario('250.00', '60.00'),
        maxScenario: scenario('100.00', '-20.00'),
        customScenario: scenario('90.00', '-30.00'),
        commissionBands: null,
        maxBasket: basket('200.00', '45.00'),
        customBasket: basket('180.00', '30.00'),
      },
    ],
  };
}

function renderClient() {
  return render(
    <MarketplaceCampaignDetailClient orgId={ORG_ID} storeId={STORE_ID} campaignId={CAMPAIGN_ID} />,
  );
}

async function waitForLoaded(): Promise<void> {
  await waitFor(() => expect(screen.getAllByText(PRODUCT).length).toBeGreaterThan(0));
}

describe('MarketplaceCampaignDetailClient', () => {
  beforeEach(() => {
    // happy-dom lacks the object-URL APIs downloadBlob needs; the anchor click is a no-op here.
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  it('headlines each price card with its OWN order on an ORDER campaign', async () => {
    server.use(http.get(BASE, () => HttpResponse.json(detailResponse())));
    renderClient();
    await waitForLoaded();

    // The maximum card shows its 2-unit order, the custom card its own — never one figure for both.
    const pays = (amount: string): string =>
      TABLE.customerPays.replace('{amount}', formatCurrency(amount));
    expect(screen.getAllByText(pays('200.00')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(pays('180.00')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(TABLE.vsWithoutCampaign).length).toBeGreaterThan(0);
  });

  it('"Kaydet ve İndir" saves the whole buffer, then — only on success — downloads', async () => {
    const order: string[] = [];
    let saved: unknown = null;
    server.use(
      http.get(BASE, () => HttpResponse.json(detailResponse())),
      http.patch(SELECTIONS_URL, async ({ request }) => {
        order.push('save');
        saved = await request.json();
        return HttpResponse.json({ updated: 1 });
      }),
      http.post(EXPORT_URL, () => {
        order.push('export');
        return new HttpResponse(XLSX_BYTES, {
          status: 200,
          headers: { 'content-type': XLSX_TYPE },
        });
      }),
    );
    const { user } = renderClient();
    await waitForLoaded();

    await user.click(screen.getByRole('button', { name: SAVE_AND_DOWNLOAD }));

    await waitFor(() => expect(order).toEqual(['save', 'export']));
    // The row stays on MAX and its typed custom price travels with it (stored independently).
    expect(saved).toEqual({
      mode: 'set',
      selections: [{ itemId: ITEM_ID, selection: 'MAX', customPrice: '180.00' }],
    });
  });

  it('a typed custom price is estimated ONCE, although the table and the cards are both mounted', async () => {
    let estimates = 0;
    server.use(
      http.get(BASE, () => HttpResponse.json(detailResponse())),
      http.post(`${BASE}/items/${ITEM_ID}/estimate`, () => {
        estimates += 1;
        return HttpResponse.json({
          itemId: ITEM_ID,
          scenario: 'custom',
          price: '300.00',
          customerPaidUnitPrice: null,
          trendyolFundedUnitAmount: null,
          commissionPct: '18.0000',
          commissionSource: 'product',
          calculable: true,
          reason: null,
          breakdown: { netProfit: '25.00', saleMarginPct: '8.33' },
          breakdownScope: 'order',
          basket: basket('150.00', '25.00'),
          commissionTariffName: null,
          commissionPeriodLabel: null,
        });
      }),
    );
    const { user } = renderClient();
    await waitForLoaded();

    // Both layouts render a custom-price input for the row; type into the first (the table's).
    const [input] = screen.getAllByRole('textbox', {
      name: TABLE.customPriceAria.replace('{product}', PRODUCT),
    });
    if (input === undefined) throw new Error('custom price input not rendered');
    await user.clear(input);
    await user.type(input, '150');

    await waitFor(() => expect(estimates).toBe(1));
    // Every card that shows or races the price shares the same answer…
    await waitFor(() =>
      expect(
        screen.getAllByText(TABLE.customerPays.replace('{amount}', formatCurrency('150.00')))
          .length,
      ).toBeGreaterThan(1),
    );
    // …and no second request ever follows.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(estimates).toBe(1);
  });

  it('keeps the download disabled until a product joins, and choosing locally sends nothing', async () => {
    let saves = 0;
    server.use(
      http.get(BASE, () => HttpResponse.json(detailResponse('NONE'))),
      http.patch(SELECTIONS_URL, () => {
        saves += 1;
        return HttpResponse.json({ updated: 1 });
      }),
    );
    const { user } = renderClient();
    await waitForLoaded();

    expect(screen.getByRole('button', { name: SAVE_AND_DOWNLOAD })).toBeDisabled();

    // Join at the maximum price — the whole card is the select target.
    const [maxCard] = screen.getAllByRole('button', {
      name: TABLE.selectMaxAria.replace('{product}', PRODUCT),
    });
    if (maxCard === undefined) throw new Error('maximum-price card not rendered');
    await user.click(maxCard);

    expect(maxCard).toHaveAttribute('aria-pressed', 'true');
    // Re-query: the disabled button sits inside its explanatory tooltip, the enabled one does not,
    // so React renders a fresh element when it flips.
    expect(screen.getByRole('button', { name: SAVE_AND_DOWNLOAD })).toBeEnabled();
    expect(saves).toBe(0);
  });
});
