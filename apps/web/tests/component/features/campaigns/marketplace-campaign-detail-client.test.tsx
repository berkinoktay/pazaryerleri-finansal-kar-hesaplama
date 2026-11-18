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

// `CurrentScopeProvider` (mounted through `TestScope`) imports the router and two server actions.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/active-store-actions', () => ({ setActiveStoreIdAction: vi.fn() }));
vi.mock('@/lib/active-org-actions', () => ({ setActiveOrgIdAction: vi.fn() }));

import { MemberRole } from '@pazarsync/db/enums';
import { formatCurrency } from '@pazarsync/utils';

import { MarketplaceCampaignDetailClient } from '@/features/campaigns/components/marketplace-campaign-detail-client';

import trMessages from '../../../../messages/tr.json';
import { TestScope, type TestScopeProps } from '../../../helpers/current-scope';
import { HttpResponse, http, server } from '../../../helpers/msw';
import { NuqsTestHarness } from '../../../helpers/nuqs';
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

/** The member's role; defaults to an owner on Trendyol. */
type ScopeOptions = Pick<TestScopeProps, 'role'>;

function renderClient(scope: ScopeOptions = {}) {
  return render(
    <NuqsTestHarness>
      <TestScope orgId={ORG_ID} storeId={STORE_ID} {...scope}>
        <MarketplaceCampaignDetailClient
          orgId={ORG_ID}
          storeId={STORE_ID}
          campaignId={CAMPAIGN_ID}
        />
      </TestScope>
    </NuqsTestHarness>,
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

    // The estimate first waits out the 400 ms debounce.
    await waitFor(() => expect(estimates).toBe(1), { timeout: 3000 });
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

// ─── Toolbar: filters, smart-select, target margin ───────────────────────────

const PAGE = trMessages.marketplaceCampaignsPage;
const CLEAR_FILTERS = trMessages.common.dataTable.noResults.clearFilters;
const WIN_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const LOSS_ID = 'aaaaaaaa-0000-0000-0000-000000000002';
const WIN = 'Kârlı Ürün';
const LOSS = 'Zararlı Ürün';

function unitItem(
  id: string,
  productTitle: string,
  maxNetProfit: string,
  hasCommissionTariff = false,
) {
  return {
    ...detailResponse().items[0],
    id,
    productTitle,
    // On a tariff per the file, yet the commission came from the product, not a band.
    hasCommissionTariff,
    selection: 'NONE',
    customPrice: null,
    maxScenario: scenario('200.00', maxNetProfit),
    customScenario: null,
    maxBasket: null,
    customBasket: null,
  };
}

/**
 * A %10 NET campaign (UNIT presentation): one product still profits at the maximum, one loses —
 * and the losing one carries the commission-tariff warning.
 */
function twoRowResponse() {
  return {
    ...detailResponse(),
    discountType: 'NET',
    valueKind: 'PERCENT',
    value: '10.00',
    buyQuantity: null,
    payQuantity: null,
    scenarioPresentation: 'UNIT',
    items: [unitItem(WIN_ID, WIN, '30.00'), unitItem(LOSS_ID, LOSS, '-12.50', true)],
  };
}

/** The first of the (desktop + mobile) toolbar copies' controls with this name. */
function first(name: string): HTMLElement {
  const [element] = screen.getAllByRole('button', { name });
  if (element === undefined) throw new Error(`no "${name}" button`);
  return element;
}

const selectedContext = (max: number, custom: number): string =>
  PAGE.summary.selectedContext.replace('{max}', String(max)).replace('{custom}', String(custom));

// These walk the whole screen through several steps: well under 2 s alone, but past the default
// 5 s cap when the full suite shares a loaded machine — which would fail a correct test.
const LONG_FLOW_TIMEOUT_MS = 15_000;

describe('MarketplaceCampaignDetailClient — toolbar', () => {
  beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  async function waitForRows(): Promise<void> {
    await waitFor(() => expect(screen.getAllByText(WIN).length).toBeGreaterThan(0));
  }

  it(
    'the chips narrow the rows, and an empty result offers to clear the filters',
    async () => {
      server.use(http.get(BASE, () => HttpResponse.json(twoRowResponse())));
      const { user } = renderClient();
      await waitForRows();

      await user.click(first(PAGE.filters.losing));
      expect(screen.queryByText(WIN)).toBeNull();
      expect(screen.getAllByText(LOSS).length).toBeGreaterThan(0);

      // Nothing is selected yet, so "Seçililer" on top leaves no row at all.
      await user.click(first(PAGE.filters.selected));
      expect(screen.queryByText(LOSS)).toBeNull();

      await user.click(first(CLEAR_FILTERS));
      expect(screen.getAllByText(WIN).length).toBeGreaterThan(0);
      expect(screen.getAllByText(LOSS).length).toBeGreaterThan(0);
      expect(first(PAGE.filters.losing)).toHaveAttribute('aria-pressed', 'false');
    },
    LONG_FLOW_TIMEOUT_MS,
  );

  it(
    'flags the row whose tariff is missing, and its chip keeps only such rows',
    async () => {
      server.use(http.get(BASE, () => HttpResponse.json(twoRowResponse())));
      const { user } = renderClient();
      await waitForRows();

      // One warned row → its badge renders (desktop + mobile) and the chip is offered.
      expect(screen.getAllByText(TABLE.tariffWarning).length).toBeGreaterThan(0);
      await user.click(first(PAGE.filters.tariffWarning));

      expect(screen.queryByText(WIN)).toBeNull();
      expect(screen.getAllByText(LOSS).length).toBeGreaterThan(0);
    },
    LONG_FLOW_TIMEOUT_MS,
  );

  it('hides the tariff chip when no row carries the warning', async () => {
    server.use(http.get(BASE, () => HttpResponse.json(detailResponse())));
    renderClient();
    await waitForLoaded();

    expect(screen.queryByRole('button', { name: PAGE.filters.tariffWarning })).toBeNull();
    expect(screen.queryByText(TABLE.tariffWarning)).toBeNull();
  });

  it(
    'a smart-select action reaches only the visible rows, and the save carries the result',
    async () => {
      let saved: unknown = null;
      server.use(
        http.get(BASE, () => HttpResponse.json(twoRowResponse())),
        http.patch(SELECTIONS_URL, async ({ request }) => {
          saved = await request.json();
          return HttpResponse.json({ updated: 2 });
        }),
        http.post(EXPORT_URL, () =>
          HttpResponse.arrayBuffer(XLSX_BYTES.buffer, { headers: { 'content-type': XLSX_TYPE } }),
        ),
      );
      const { user } = renderClient();
      await waitForRows();

      // Show only the losing row, then pull "everything" to the maximum price.
      await user.click(first(PAGE.filters.losing));
      await user.click(first(PAGE.smartSelect.label));
      await user.click(await screen.findByRole('button', { name: PAGE.smartSelect.selectAllMax }));
      await user.click(first(PAGE.filters.losing));

      // The hidden profitable row kept its (empty) choice — one joins, at the maximum.
      expect(screen.getByText(selectedContext(1, 0))).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: SAVE_AND_DOWNLOAD }));
      await waitFor(() =>
        expect(saved).toEqual({
          mode: 'set',
          selections: [
            { itemId: WIN_ID, selection: 'NONE', customPrice: null },
            { itemId: LOSS_ID, selection: 'MAX', customPrice: null },
          ],
        }),
      );
    },
    LONG_FLOW_TIMEOUT_MS,
  );

  it(
    'the target margin fills custom prices into the buffer and marks the unreachable row',
    async () => {
      let saved: unknown = null;
      server.use(
        http.get(BASE, () => HttpResponse.json(twoRowResponse())),
        http.post(`${BASE}/target-margin`, () =>
          HttpResponse.json({
            suggestions: [
              { itemId: WIN_ID, price: '185.40', reason: null },
              { itemId: LOSS_ID, price: null, reason: 'UNREACHABLE' },
            ],
          }),
        ),
        // The filled price is a new what-if, so its card asks for an estimate.
        http.post(`${BASE}/items/${WIN_ID}/estimate`, () =>
          HttpResponse.json({
            itemId: WIN_ID,
            scenario: 'custom',
            price: '185.40',
            customerPaidUnitPrice: '166.86',
            trendyolFundedUnitAmount: null,
            commissionPct: '18.0000',
            commissionSource: 'product',
            calculable: true,
            reason: null,
            breakdown: { netProfit: '22.00', saleMarginPct: '13.18' },
            breakdownScope: 'unit',
            basket: null,
            commissionTariffName: null,
            commissionPeriodLabel: null,
          }),
        ),
        http.patch(SELECTIONS_URL, async ({ request }) => {
          saved = await request.json();
          return HttpResponse.json({ updated: 2 });
        }),
        http.post(EXPORT_URL, () =>
          HttpResponse.arrayBuffer(XLSX_BYTES.buffer, { headers: { 'content-type': XLSX_TYPE } }),
        ),
      );
      const { user } = renderClient();
      await waitForRows();

      await user.click(first(PAGE.smartSelect.label));
      await user.click(await screen.findByRole('button', { name: PAGE.smartSelect.targetMargin }));
      await user.type(await screen.findByRole('textbox', { name: PAGE.targetMargin.label }), '10');
      await user.click(screen.getByRole('button', { name: PAGE.targetMargin.submit }));

      // The suggested price lands in the row's custom input (both layouts; the editing format drops
      // the trailing zero)…
      await waitFor(() => {
        const inputs = screen.getAllByRole('textbox', {
          name: TABLE.customPriceAria.replace('{product}', WIN),
        });
        for (const input of inputs) expect(input).toHaveValue('185,4');
      });
      // …the unreachable row says why it was left out, and nothing has been saved yet.
      expect(screen.getAllByText(TABLE.targetMarginUnreachable).length).toBeGreaterThan(0);
      expect(screen.getByText(selectedContext(0, 1))).toBeInTheDocument();
      expect(saved).toBeNull();

      await user.click(screen.getByRole('button', { name: SAVE_AND_DOWNLOAD }));
      await waitFor(() =>
        expect(saved).toEqual({
          mode: 'set',
          selections: [
            { itemId: WIN_ID, selection: 'CUSTOM', customPrice: '185.40' },
            { itemId: LOSS_ID, selection: 'NONE', customPrice: null },
          ],
        }),
      );
    },
    LONG_FLOW_TIMEOUT_MS,
  );
});

// ─── Access: a member who cannot write ───────────────────────────────────────

describe('MarketplaceCampaignDetailClient — access', () => {
  const NOTICE = trMessages.campaignAccess.readOnlyNotice;
  const SELECT_MAX = TABLE.selectMaxAria.replace('{product}', PRODUCT);
  const CUSTOM_PRICE = TABLE.customPriceAria.replace('{product}', PRODUCT);

  it('shows a read-only member the notice and the saved choice, with no write control', async () => {
    // The fixture row is saved on MAX.
    server.use(http.get(BASE, () => HttpResponse.json(detailResponse('MAX'))));
    const { user } = renderClient({ role: MemberRole.VIEWER });
    await waitForLoaded();

    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: SAVE_AND_DOWNLOAD })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: PAGE.templates.delete })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: PAGE.configCard.edit })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: PAGE.smartSelect.label })).toHaveLength(0);
    // The maximum-price card has no select target (the writer cases click exactly this button).
    expect(screen.queryAllByRole('button', { name: SELECT_MAX })).toHaveLength(0);

    const inputs = screen.getAllByRole('textbox', { name: CUSTOM_PRICE });
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) expect(input).toBeDisabled();

    // The saved MAX choice still shows, and a click on the card's price changes nothing.
    expect(screen.getAllByText(TABLE.selected).length).toBeGreaterThan(0);
    const [priceText] = screen.getAllByText(formatCurrency('200.00'));
    if (priceText === undefined) throw new Error('maximum price not rendered');
    await user.click(priceText);
    expect(screen.getAllByText(TABLE.selected).length).toBeGreaterThan(0);
  });

  it('offers the lowest writing role save and delete, with no notice', async () => {
    server.use(http.get(BASE, () => HttpResponse.json(detailResponse('MAX'))));
    renderClient({ role: MemberRole.MEMBER });
    await waitForLoaded();

    expect(screen.getByRole('button', { name: SAVE_AND_DOWNLOAD })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: PAGE.templates.delete })).toBeInTheDocument();
    expect(screen.queryByText(NOTICE)).toBeNull();
  });
});
