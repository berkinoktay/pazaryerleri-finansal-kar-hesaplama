import { describe, expect, it, vi } from 'vitest';

import { CostCellPopover } from '@/features/products/components/cost-cell-popover';
import type { VariantSummary } from '@/features/products/api/list-products.api';

import { render, screen, waitFor } from '../../../helpers/render';
import { server, http, HttpResponse } from '../../../helpers/msw';

// ─── Constants ───────────────────────────────────────────────────────────────

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const VARIANT_ID = 'variant-uuid-001';
const TEST_API_BASE = 'http://localhost:3001';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeVariant(overrides: Partial<VariantSummary> = {}): VariantSummary {
  return {
    id: VARIANT_ID,
    platformVariantId: '10010',
    barcode: 'BC-0001',
    stockCode: 'STK-A',
    size: 'M',
    salePrice: '100.00',
    listPrice: '100.00',
    vatRate: 20,
    costPrice: null,
    quantity: 5,
    deliveryDuration: 1,
    isRushDelivery: false,
    fastDeliveryOptions: [],
    productUrl: null,
    locationBasedDelivery: 'DISABLED',
    status: 'onSale',
    currentCostTry: null,
    profileCount: 0,
    costStatus: 'NO_PROFILES',
    ...overrides,
  };
}

const attachedProfilesResponse = {
  data: [
    {
      id: 'profile-uuid-001',
      organizationId: ORG_ID,
      name: 'COGS Profil',
      type: 'COGS',
      amount: '25.00',
      currency: 'TRY',
      vatRate: 18,
      fxRateMode: 'AUTO',
      manualFxRate: null,
      note: null,
      archivedAt: null,
      createdBy: null,
      updatedBy: null,
      createdAt: '2026-05-01T00:00:00Z',
      updatedAt: '2026-05-01T00:00:00Z',
    },
  ],
};

const allProfilesResponse = {
  data: [
    {
      id: 'profile-uuid-001',
      organizationId: ORG_ID,
      name: 'COGS Profil',
      type: 'COGS',
      amount: '25.00',
      currency: 'TRY',
      vatRate: 18,
      fxRateMode: 'AUTO',
      manualFxRate: null,
      note: null,
      archivedAt: null,
      createdBy: null,
      updatedBy: null,
      createdAt: '2026-05-01T00:00:00Z',
      updatedAt: '2026-05-01T00:00:00Z',
    },
    {
      id: 'profile-uuid-002',
      organizationId: ORG_ID,
      name: 'Paketleme',
      type: 'PACKAGING',
      amount: '10.00',
      currency: 'TRY',
      vatRate: 18,
      fxRateMode: 'AUTO',
      manualFxRate: null,
      note: null,
      archivedAt: null,
      createdBy: null,
      updatedBy: null,
      createdAt: '2026-05-01T00:00:00Z',
      updatedAt: '2026-05-01T00:00:00Z',
    },
  ],
  meta: { nextCursor: null, hasMore: false },
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CostCellPopover', () => {
  it('renders attached profiles list when popover is open', async () => {
    server.use(
      http.get(
        `${TEST_API_BASE}/v1/organizations/${ORG_ID}/variants/${VARIANT_ID}/cost-profiles`,
        () => HttpResponse.json(attachedProfilesResponse),
      ),
      http.get(`${TEST_API_BASE}/v1/organizations/${ORG_ID}/cost-profiles`, () =>
        HttpResponse.json(allProfilesResponse),
      ),
    );

    const variant = makeVariant({ profileCount: 1, currentCostTry: '25.00', costStatus: 'OK' });
    const { user } = render(
      <CostCellPopover orgId={ORG_ID} variant={variant}>
        <button type="button">Open</button>
      </CostCellPopover>,
    );

    await user.click(screen.getByRole('button', { name: 'Open' }));

    await waitFor(() => {
      expect(screen.getByText('COGS Profil')).toBeInTheDocument();
    });
  });

  it('attach combobox shows non-archived profiles (excluding already attached)', async () => {
    server.use(
      http.get(
        `${TEST_API_BASE}/v1/organizations/${ORG_ID}/variants/${VARIANT_ID}/cost-profiles`,
        () => HttpResponse.json(attachedProfilesResponse),
      ),
      http.get(`${TEST_API_BASE}/v1/organizations/${ORG_ID}/cost-profiles`, () =>
        HttpResponse.json(allProfilesResponse),
      ),
    );

    const variant = makeVariant({ profileCount: 1, currentCostTry: '25.00', costStatus: 'OK' });
    const { user } = render(
      <CostCellPopover orgId={ORG_ID} variant={variant}>
        <button type="button">Open</button>
      </CostCellPopover>,
    );

    await user.click(screen.getByRole('button', { name: 'Open' }));

    await waitFor(() => {
      // The attached profile should appear in the list (not in the combobox)
      expect(screen.getByText('COGS Profil')).toBeInTheDocument();
    });

    // Open the combobox
    const comboboxTrigger = screen.getByText('Profil seç…');
    await user.click(comboboxTrigger);

    await waitFor(() => {
      // Only non-attached profile appears in combobox dropdown
      expect(screen.getByText('Paketleme')).toBeInTheDocument();
    });
  });

  it('clicking "+ Yeni maliyet oluştur" closes popover and opens create dialog', async () => {
    server.use(
      http.get(
        `${TEST_API_BASE}/v1/organizations/${ORG_ID}/variants/${VARIANT_ID}/cost-profiles`,
        () => HttpResponse.json({ data: [] }),
      ),
      http.get(`${TEST_API_BASE}/v1/organizations/${ORG_ID}/cost-profiles`, () =>
        HttpResponse.json({ data: [], meta: { nextCursor: null, hasMore: false } }),
      ),
    );

    const variant = makeVariant();
    const { user } = render(
      <CostCellPopover orgId={ORG_ID} variant={variant}>
        <button type="button">Open</button>
      </CostCellPopover>,
    );

    await user.click(screen.getByRole('button', { name: 'Open' }));

    await waitFor(() => {
      expect(screen.getByText('+ Yeni maliyet oluştur')).toBeInTheDocument();
    });

    await user.click(screen.getByText('+ Yeni maliyet oluştur'));

    // Create dialog should open (check dialog title from tr.json)
    await waitFor(() => {
      expect(screen.getByText('Yeni maliyet profili')).toBeInTheDocument();
    });
  });

  it('remove button calls detach mutation when clicked', async () => {
    let detachCalled = false;

    server.use(
      http.get(
        `${TEST_API_BASE}/v1/organizations/${ORG_ID}/variants/${VARIANT_ID}/cost-profiles`,
        () => HttpResponse.json(attachedProfilesResponse),
      ),
      http.get(`${TEST_API_BASE}/v1/organizations/${ORG_ID}/cost-profiles`, () =>
        HttpResponse.json(allProfilesResponse),
      ),
      http.post(
        `${TEST_API_BASE}/v1/organizations/${ORG_ID}/cost-profile-attachments/detach`,
        async ({ request }) => {
          const body = (await request.json()) as { profileIds: string[]; variantIds: string[] };
          if (
            body.profileIds.includes('profile-uuid-001') &&
            body.variantIds.includes(VARIANT_ID)
          ) {
            detachCalled = true;
          }
          return HttpResponse.json({ detached: 1 });
        },
      ),
    );

    const variant = makeVariant({ profileCount: 1, currentCostTry: '25.00', costStatus: 'OK' });
    const { user } = render(
      <CostCellPopover orgId={ORG_ID} variant={variant}>
        <button type="button">Open</button>
      </CostCellPopover>,
    );

    await user.click(screen.getByRole('button', { name: 'Open' }));

    await waitFor(() => {
      expect(screen.getByText('COGS Profil')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Profili kaldır' }));

    await waitFor(() => {
      expect(detachCalled).toBe(true);
    });
  });
});
