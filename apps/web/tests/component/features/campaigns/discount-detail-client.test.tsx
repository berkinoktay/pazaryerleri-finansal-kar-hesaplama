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

import { NuqsTestHarness } from '../../../helpers/nuqs';
import { HttpResponse, http, server } from '../../../helpers/msw';
import { render, screen, waitFor } from '../../../helpers/render';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const LIST_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const ITEM_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const BASE = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/discount-lists/${LIST_ID}`;
const DETAIL_URL = BASE;
const SELECTIONS_URL = `${BASE}/selections`;
const EXPORT_URL = `${BASE}/export`;

const CHECKBOX_LABEL = 'Bu ürünü kampanyaya dahil et';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLSX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

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
      },
    ],
  };
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
