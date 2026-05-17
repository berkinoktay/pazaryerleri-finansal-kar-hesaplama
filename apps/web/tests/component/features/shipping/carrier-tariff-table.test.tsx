import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { CarrierTariffTable } from '@/features/shipping/components/carrier-tariff-table';

import { HttpResponse, http, server } from '../../../helpers/msw';
import { render, screen, waitFor } from '../../../helpers/render';

// ─── Constants ────────────────────────────────────────────────────────────────

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const CARRIER_ID_BAREM = '7f4e8c4a-bc23-4d3e-9b1a-0a1f2c3d4e5f';
const CARRIER_ID_NO_BAREM = '8a5d9e6b-cd34-4e4f-a2c0-1b2d3e4f5060';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CARRIER_BAREM = {
  id: CARRIER_ID_BAREM,
  platform: 'TRENDYOL' as const,
  externalId: 38,
  code: 'SENDEOMP',
  displayName: 'Kolay Gelsin',
  supportsBaremDestek: true,
  maxBaremDesi: 10,
  sortOrder: 7,
};

const CARRIER_NO_BAREM = {
  id: CARRIER_ID_NO_BAREM,
  platform: 'TRENDYOL' as const,
  externalId: 19,
  code: 'CEVAMP',
  displayName: 'CEVA Lojistik',
  supportsBaremDestek: false,
  maxBaremDesi: 0,
  sortOrder: 9,
};

const DESI_ROWS = [
  { desi: 1, priceNet: '29.99' },
  { desi: 2, priceNet: '35.49' },
  { desi: 3, priceNet: '41.99' },
];

const BAREM_ROWS = [
  { minOrderAmount: '0', maxOrderAmount: '200', priceNet: '24.99' },
  { minOrderAmount: '200.01', maxOrderAmount: '500', priceNet: '19.99' },
];

function setupCarrierWithBarem() {
  server.use(
    http.get(
      `http://localhost:3001/v1/organizations/${ORG_ID}/shipping-carriers/${CARRIER_ID_BAREM}/tariffs`,
      () =>
        HttpResponse.json({
          carrier: CARRIER_BAREM,
          desiTariffs: DESI_ROWS,
          baremTariffs: BAREM_ROWS,
        }),
    ),
  );
}

function setupCarrierWithoutBarem() {
  server.use(
    http.get(
      `http://localhost:3001/v1/organizations/${ORG_ID}/shipping-carriers/${CARRIER_ID_NO_BAREM}/tariffs`,
      () =>
        HttpResponse.json({
          carrier: CARRIER_NO_BAREM,
          desiTariffs: DESI_ROWS,
          baremTariffs: [],
        }),
    ),
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CarrierTariffTable', () => {
  it('renders the desi-bazlı tariff rows for any selected carrier', async () => {
    setupCarrierWithBarem();

    render(<CarrierTariffTable orgId={ORG_ID} carrierId={CARRIER_ID_BAREM} />);

    await waitFor(() => {
      expect(screen.getByText('Desi Bazlı Tarife')).toBeInTheDocument();
    });
    // The desi-row keys appear as cell text — assert against the literal
    // desi values from the fixture so a render-shape regression surfaces.
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders the Barem desteği section when the carrier supports it', async () => {
    setupCarrierWithBarem();

    render(<CarrierTariffTable orgId={ORG_ID} carrierId={CARRIER_ID_BAREM} />);

    await waitFor(() => {
      expect(screen.getByText('Barem Desteği')).toBeInTheDocument();
    });
    // The Barem section header should be visible — proof the conditional
    // path fired against the supportsBaremDestek=true carrier.
    expect(screen.getByText('Sipariş Tutarı')).toBeInTheDocument();
  });

  it('hides the Barem desteği section when the carrier does not support it', async () => {
    setupCarrierWithoutBarem();

    render(<CarrierTariffTable orgId={ORG_ID} carrierId={CARRIER_ID_NO_BAREM} />);

    await waitFor(() => {
      expect(screen.getByText('Desi Bazlı Tarife')).toBeInTheDocument();
    });
    // The Barem heading must NOT be rendered for a non-Barem carrier.
    expect(screen.queryByText('Barem Desteği')).not.toBeInTheDocument();
    expect(screen.queryByText('Sipariş Tutarı')).not.toBeInTheDocument();
  });
});
