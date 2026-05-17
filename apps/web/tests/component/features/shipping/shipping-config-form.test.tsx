import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { ShippingConfigForm } from '@/features/shipping/components/shipping-config-form';

import { HttpResponse, http, server } from '../../../helpers/msw';
import { render, screen, waitFor } from '../../../helpers/render';

// ─── Constants ────────────────────────────────────────────────────────────────

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const STORE_ID = '11111111-1111-1111-1111-111111111111';
// Valid v4 UUIDs — the form's zod schema strictly validates UUID format
// (Zod 4 enforces version + variant digits). Placeholder strings like
// "aaaa-aaaa-..." silently fail the safeParse and short-circuit the save.
const CARRIER_ID_A = '7f4e8c4a-bc23-4d3e-9b1a-0a1f2c3d4e5f';
const CARRIER_ID_B = '8a5d9e6b-cd34-4e4f-a2c0-1b2d3e4f5060';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CARRIERS_RESPONSE = {
  data: [
    {
      id: CARRIER_ID_A,
      platform: 'TRENDYOL',
      externalId: 38,
      code: 'SENDEOMP',
      displayName: 'Kolay Gelsin',
      supportsBaremDestek: true,
      maxBaremDesi: 10,
      sortOrder: 7,
    },
    {
      id: CARRIER_ID_B,
      platform: 'TRENDYOL',
      externalId: 19,
      code: 'CEVAMP',
      displayName: 'CEVA Lojistik',
      supportsBaremDestek: false,
      maxBaremDesi: 0,
      sortOrder: 9,
    },
  ],
};

const CONFIG_TRENDYOL_NO_CARRIER = {
  shippingTariffSource: 'TRENDYOL_CONTRACT',
  defaultShippingCarrier: null,
};

const CONFIG_TRENDYOL_WITH_CARRIER = {
  shippingTariffSource: 'TRENDYOL_CONTRACT',
  defaultShippingCarrier: CARRIERS_RESPONSE.data[0],
};

function setupHandlers(
  initialConfig: typeof CONFIG_TRENDYOL_WITH_CARRIER | typeof CONFIG_TRENDYOL_NO_CARRIER,
) {
  server.use(
    http.get(`http://localhost:3001/v1/organizations/${ORG_ID}/shipping-carriers`, () =>
      HttpResponse.json(CARRIERS_RESPONSE),
    ),
    http.get(
      `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/shipping-config`,
      () => HttpResponse.json(initialConfig),
    ),
    // The form mounts CarrierTariffTable whenever a carrier is selected, so
    // any *WITH_CARRIER* run also kicks off a /tariffs GET. Stub it with a
    // minimal payload for both carrier ids the test fixtures use; routes
    // that aren't hit are ignored, so this stays cheap.
    http.get(
      `http://localhost:3001/v1/organizations/${ORG_ID}/shipping-carriers/${CARRIER_ID_A}/tariffs`,
      () =>
        HttpResponse.json({
          carrier: CARRIERS_RESPONSE.data[0],
          desiTariffs: [{ desi: 1, priceNet: '29.99' }],
          baremTariffs: [{ minOrderAmount: '0', maxOrderAmount: '200', priceNet: '24.99' }],
        }),
    ),
    http.get(
      `http://localhost:3001/v1/organizations/${ORG_ID}/shipping-carriers/${CARRIER_ID_B}/tariffs`,
      () =>
        HttpResponse.json({
          carrier: CARRIERS_RESPONSE.data[1],
          desiTariffs: [{ desi: 1, priceNet: '29.99' }],
          baremTariffs: [],
        }),
    ),
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ShippingConfigForm', () => {
  it('renders the carrier dropdown for the default TRENDYOL_CONTRACT segment', async () => {
    setupHandlers(CONFIG_TRENDYOL_WITH_CARRIER);

    render(<ShippingConfigForm orgId={ORG_ID} storeId={STORE_ID} platform="TRENDYOL" />);

    await waitFor(() => {
      expect(screen.getByText('Varsayılan Kargo Firması')).toBeInTheDocument();
    });
    // The dropdown is in the document, not the empty state CTA
    expect(screen.queryByText(/Excel ile yükle/)).not.toBeInTheDocument();
  });

  it('switches to the OWN_CONTRACT empty state when the second segment is clicked', async () => {
    setupHandlers(CONFIG_TRENDYOL_WITH_CARRIER);

    const { user } = render(
      <ShippingConfigForm orgId={ORG_ID} storeId={STORE_ID} platform="TRENDYOL" />,
    );

    // Wait for first render
    await waitFor(() => {
      expect(screen.getByText('Varsayılan Kargo Firması')).toBeInTheDocument();
    });

    // Click "Kendi Anlaşmam" tab
    const ownContractTab = screen.getByRole('tab', { name: 'Kendi Anlaşmam' });
    await user.click(ownContractTab);

    expect(await screen.findByText('Kendi Tarifenizi Yükleyin')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Excel ile yükle/ })).toBeDisabled();
    expect(screen.queryByText('Varsayılan Kargo Firması')).not.toBeInTheDocument();
  });

  it('submits the carrier choice to the PATCH endpoint when Kaydet is clicked', async () => {
    setupHandlers(CONFIG_TRENDYOL_WITH_CARRIER);

    let receivedBody: unknown = null;
    server.use(
      http.patch(
        `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/shipping-config`,
        async ({ request }) => {
          receivedBody = await request.json();
          return HttpResponse.json(CONFIG_TRENDYOL_WITH_CARRIER);
        },
      ),
    );

    const { user } = render(
      <ShippingConfigForm orgId={ORG_ID} storeId={STORE_ID} platform="TRENDYOL" />,
    );

    // Wait for the GET to seed state with CARRIER_ID_A
    await waitFor(() => {
      expect(screen.getByText('Varsayılan Kargo Firması')).toBeInTheDocument();
    });

    const saveButton = screen.getByRole('button', { name: 'Kaydet' });
    await user.click(saveButton);

    await waitFor(() => {
      expect(receivedBody).toEqual({
        shippingTariffSource: 'TRENDYOL_CONTRACT',
        defaultShippingCarrierId: CARRIER_ID_A,
      });
    });
  });

  it('shows the inline carrier-required error when saving on TRENDYOL_CONTRACT with no carrier', async () => {
    setupHandlers(CONFIG_TRENDYOL_NO_CARRIER);

    const { user } = render(
      <ShippingConfigForm orgId={ORG_ID} storeId={STORE_ID} platform="TRENDYOL" />,
    );

    // Wait for the initial config to load (carrier = null)
    await waitFor(() => {
      expect(screen.getByText('Varsayılan Kargo Firması')).toBeInTheDocument();
    });

    const saveButton = screen.getByRole('button', { name: 'Kaydet' });
    await user.click(saveButton);

    // The client-side schema catches the missing carrier and surfaces the
    // backend's domain error code as a localized inline message under the
    // dropdown.
    expect(
      await screen.findByText('Trendyol Anlaşmalı seçildiyse kargo firması zorunludur.'),
    ).toBeInTheDocument();
  });
});
