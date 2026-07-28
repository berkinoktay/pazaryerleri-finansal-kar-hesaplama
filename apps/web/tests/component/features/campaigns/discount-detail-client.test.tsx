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

import { DiscountDetailClient } from '@/features/campaigns/components/discount-detail-client';

import trMessages from '../../../../messages/tr.json';
import { NuqsTestHarness } from '../../../helpers/nuqs';
import { HttpResponse, http, server } from '../../../helpers/msw';
import { render, screen, waitFor, within } from '../../../helpers/render';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const LIST_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const ITEM_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const BASE = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/discount-lists/${LIST_ID}`;
const DETAIL_URL = BASE;
const SELECTIONS_URL = `${BASE}/selections`;
const EXPORT_URL = `${BASE}/export`;
const ESTIMATE_URL = `${BASE}/items/${ITEM_ID}/estimate`;

const CHECKBOX_LABEL = 'Bu ürünü kampanyaya dahil et';
const PROFIT_BADGE_LABEL = 'Kâr detayını gör';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLSX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

// Footer + modal copy comes from tr.json (never hand-typed Turkish) — same pattern the sibling
// discount-scenario-chip test uses for the settlement labels.
const SCENARIO_LABELS = trMessages.discountsPage.scenario;
const BREAKDOWN_TITLE = trMessages.discountsPage.breakdown.title;

/** next-intl interpolates `{qty}`; the test rebuilds the same string to match the rendered label. */
function withQty(template: string, qty: number): string {
  return template.replace('{qty}', String(qty));
}

function scenario(netProfit: string | null) {
  return {
    price: '100.00',
    commissionPct: '20.00',
    commissionSource: 'band',
    netProfit,
    marginPct: netProfit,
  };
}

/** One matched, calculable item. `included: true` on the wire is deliberately IGNORED by the UI. */
function detailResponse() {
  return {
    id: LIST_ID,
    name: 'Temmuz İndirimleri',
    discountType: 'NET',
    valueKind: 'PERCENT',
    value: '20',
    minBasketAmount: null,
    minQuantity: null,
    buyQuantity: null,
    payQuantity: null,
    nthIndex: null,
    startsAt: null,
    endsAt: null,
    exported: false,
    commissionTariffName: null,
    commissionPeriodLabel: null,
    commissionTariffOutdated: false,
    items: [
      {
        id: ITEM_ID,
        barcode: '8681234567890',
        modelCode: 'MODEL-1',
        externalId: 'ext-1',
        productTitle: 'Test Ürün',
        brand: 'Marka B',
        color: 'Siyah',
        imageUrl: 'https://cdn.example/urun.jpg',
        included: true,
        calculable: true,
        reason: null,
        current: scenario('25.00'),
        discounted: scenario('10.00'),
        commissionBands: null,
        // NET moves the showcase price, so it carries no basket-scenario block.
        scenario: null,
      },
    ],
  };
}

/** A basket-scoped settlement scenario (n = 2) for the CONDITIONAL_BASKET fixture below. */
function scenarioBlock() {
  return {
    assumedQuantity: 2,
    basketTotal: '200.00',
    basketPaidTotal: '150.00',
    basketDiscountTotal: '50.00',
    orderNetProfit: '20.00',
  };
}

/** A basket-scoped list: the discounted column reframes to "Hakediş senaryosu" + shows the chip. */
function conditionalBasketResponse() {
  const base = detailResponse();
  return {
    ...base,
    discountType: 'CONDITIONAL_BASKET',
    minBasketAmount: '150',
    items: base.items.map((item) => ({ ...item, scenario: scenarioBlock() })),
  };
}

/**
 * Same basket-scoped list, but the order-level net profit is not calculable — every other scenario
 * field stays populated, only `orderNetProfit` drops to null (the backend emits this when a
 * required input for the order-profit line is missing).
 */
function conditionalBasketResponseNullProfit() {
  const base = detailResponse();
  return {
    ...base,
    discountType: 'CONDITIONAL_BASKET',
    minBasketAmount: '150',
    items: base.items.map((item) => ({
      ...item,
      scenario: { ...scenarioBlock(), orderNetProfit: null },
    })),
  };
}

/** A calculable estimate breakdown — the four groups close to saleGross, as the backend emits. */
function estimateBreakdown() {
  return {
    listGross: '100.00',
    sellerDiscountGross: '0.00',
    saleGross: '100.00',
    saleVat: '16.67',
    costGross: '50.00',
    costVat: '8.33',
    commissionGross: '20.00',
    commissionVat: '3.33',
    shippingGross: '15.00',
    shippingVat: '2.50',
    platformServiceGross: '0.00',
    platformServiceVat: '0.00',
    stoppage: '0.00',
    netVat: '5.84',
    netProfit: '10.00',
    saleMarginPct: '10.00',
    costMarkupPct: '20.00',
    marketplaceFeesGross: '35.00',
    taxesGross: '5.84',
    totalDeductionsGross: '90.00',
  };
}

/** The on-demand estimate for one scenario — a normal calculable 200. */
function estimateResult(scenarioKey: 'current' | 'discounted') {
  return {
    itemId: ITEM_ID,
    scenario: scenarioKey,
    price: '100.00',
    commissionPct: '20.00',
    commissionSource: 'band',
    calculable: true,
    reason: null,
    breakdown: estimateBreakdown(),
    commissionTariffName: null,
    commissionPeriodLabel: null,
  };
}

/** The first profit badge whose amount contains `amountText` (netProfit distinguishes the pair). */
function findProfitBadge(amountText: string): HTMLElement {
  const badge = screen
    .getAllByRole('button', { name: PROFIT_BADGE_LABEL })
    .find((button) => button.textContent?.includes(amountText));
  if (badge === undefined) throw new Error(`profit badge with amount "${amountText}" not found`);
  return badge;
}

function renderClient() {
  return render(
    <NuqsTestHarness>
      <DiscountDetailClient orgId={ORG_ID} storeId={STORE_ID} listId={LIST_ID} />
    </NuqsTestHarness>,
  );
}

async function waitForLoaded(): Promise<void> {
  await waitFor(() => expect(screen.getAllByText('Test Ürün').length).toBeGreaterThan(0));
}

describe('DiscountDetailClient — ephemeral selection', () => {
  beforeEach(() => {
    // happy-dom lacks the object-URL APIs downloadBlob needs; the anchor click is a no-op here.
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  it('starts with an EMPTY selection (does not seed from the wire `included` flag)', async () => {
    server.use(http.get(DETAIL_URL, () => HttpResponse.json(detailResponse())));
    renderClient();

    await waitForLoaded();
    // Despite `included: true` on the wire, every checkbox (desktop + mobile layout) is off.
    for (const box of screen.getAllByRole('checkbox', { name: CHECKBOX_LABEL })) {
      expect(box).not.toBeChecked();
    }
  });

  it('does NOT hit the network when a checkbox is toggled (selection is local)', async () => {
    let patchCalls = 0;
    let exportCalls = 0;
    server.use(
      http.get(DETAIL_URL, () => HttpResponse.json(detailResponse())),
      http.patch(SELECTIONS_URL, () => {
        patchCalls += 1;
        return HttpResponse.json({ updated: 1 });
      }),
      http.post(EXPORT_URL, () => {
        exportCalls += 1;
        return new HttpResponse(XLSX_BYTES, {
          status: 200,
          headers: { 'content-type': XLSX_TYPE },
        });
      }),
    );

    const { user } = renderClient();
    await waitForLoaded();

    const checkbox = screen.getAllByRole('checkbox', { name: CHECKBOX_LABEL })[0];
    await user.click(checkbox);

    // Local toggle only: the box flips on, but NO selections PATCH and NO export ever fired.
    expect(checkbox).toBeChecked();
    expect(patchCalls).toBe(0);
    expect(exportCalls).toBe(0);
  });

  it('"Kaydet ve İndir" flushes the full selection THEN downloads on flush success', async () => {
    const order: string[] = [];
    let patchBody: { mode?: string; selections?: { itemId: string; included: boolean }[] } = {};
    server.use(
      http.get(DETAIL_URL, () => HttpResponse.json(detailResponse())),
      http.patch(SELECTIONS_URL, async ({ request }) => {
        order.push('patch');
        patchBody = (await request.json()) as typeof patchBody;
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

    // Save is disabled while nothing is selected; select the row to enable it.
    await user.click(screen.getAllByRole('checkbox', { name: CHECKBOX_LABEL })[0]);

    const saveButton = screen.getByRole('button', { name: 'Kaydet ve İndir' });
    expect(saveButton).toBeEnabled();
    await user.click(saveButton);

    // The flush runs first, then — only on its success — the export download.
    await waitFor(() => expect(order).toEqual(['patch', 'export']));
    // The flush mirrors the FULL local selection: every row, with its included flag.
    expect(patchBody.mode).toBe('set');
    expect(patchBody.selections).toEqual([{ itemId: ITEM_ID, included: true }]);
  });
});

describe('DiscountDetailClient — settlement scenario framing', () => {
  it('NET keeps the "İndirimli fiyat" column header and shows no scenario chip', async () => {
    server.use(http.get(DETAIL_URL, () => HttpResponse.json(detailResponse())));
    renderClient();

    await waitForLoaded();
    expect(screen.getAllByText('İndirimli fiyat').length).toBeGreaterThan(0);
    expect(screen.queryByText('×2 adet')).toBeNull();
  });

  it('basket-scoped types reframe the header to "Hakediş senaryosu" and render the chip', async () => {
    server.use(http.get(DETAIL_URL, () => HttpResponse.json(conditionalBasketResponse())));
    renderClient();

    await waitForLoaded();
    expect(screen.getAllByText('Hakediş senaryosu').length).toBeGreaterThan(0);
    expect(screen.getAllByText('×2 adet').length).toBeGreaterThan(0);
  });
});

describe('DiscountDetailClient — settlement scenario in the breakdown footer', () => {
  it('shows the order-level "Sipariş kârı" row when the DISCOUNTED scenario modal opens', async () => {
    server.use(
      http.get(DETAIL_URL, () => HttpResponse.json(conditionalBasketResponse())),
      http.post(ESTIMATE_URL, () => HttpResponse.json(estimateResult('discounted'))),
    );
    const { user } = renderClient();
    await waitForLoaded();

    // The discounted scenario's badge carries the discounted netProfit (₺10,00); the current one
    // carries ₺25,00 — the amount distinguishes them among the desktop + mobile badge copies.
    await user.click(findProfitBadge('10,00'));

    // The footer surfaces the assumed single-product basket's order-level net profit (n = 2).
    expect(await screen.findByText('Sipariş kârı (2 adet)')).toBeInTheDocument();
  });

  it('does NOT show the "Sipariş kârı" row when the CURRENT scenario modal opens', async () => {
    server.use(
      http.get(DETAIL_URL, () => HttpResponse.json(conditionalBasketResponse())),
      http.post(ESTIMATE_URL, () => HttpResponse.json(estimateResult('current'))),
    );
    const { user } = renderClient();
    await waitForLoaded();

    await user.click(findProfitBadge('25,00'));

    // The modal opens (its title renders), but the current scenario carries no basket assumption,
    // so no settlement footer.
    expect(await screen.findByText('Kâr dökümü')).toBeInTheDocument();
    expect(screen.queryByText('Sipariş kârı (2 adet)')).toBeNull();
  });

  it('renders the settlement footer WITHOUT the "Sipariş kârı" row when orderNetProfit is null', async () => {
    server.use(
      http.get(DETAIL_URL, () => HttpResponse.json(conditionalBasketResponseNullProfit())),
      http.post(ESTIMATE_URL, () => HttpResponse.json(estimateResult('discounted'))),
    );
    const { user } = renderClient();
    await waitForLoaded();

    // Open the DISCOUNTED scenario modal — that is the only view the client hands the scenario to.
    await user.click(findProfitBadge('10,00'));

    // Scope to the modal: "Sepet indirimi" is also the CONDITIONAL_BASKET type label on the page,
    // so an unscoped match would be ambiguous.
    const modal = within(await screen.findByRole('dialog'));
    // The footer still renders its price rows — the assumed basket is fully computed.
    expect(modal.getByText(BREAKDOWN_TITLE)).toBeInTheDocument();
    expect(modal.getByText(SCENARIO_LABELS.paidTotal)).toBeInTheDocument();
    expect(modal.getByText(SCENARIO_LABELS.basketDiscount)).toBeInTheDocument();
    // ...but the order-level profit row is omitted because orderNetProfit is null.
    expect(modal.queryByText(withQty(SCENARIO_LABELS.orderProfit, 2))).toBeNull();
  });
});
