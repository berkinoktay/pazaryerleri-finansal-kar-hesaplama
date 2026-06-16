import { describe, expect, it } from 'vitest';

import { CostCellPopover } from '@/features/costs/components/cost-cell-popover';

import { render, screen, waitFor } from '../../../helpers/render';
import { server, http, HttpResponse } from '../../../helpers/msw';

// ─── Constants ───────────────────────────────────────────────────────────────

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const VARIANT_ID = 'variant-uuid-001';
const TEST_API_BASE = 'http://localhost:3001';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const attachedProfilesResponse = {
  data: [
    {
      id: 'profile-uuid-001',
      organizationId: ORG_ID,
      name: 'COGS Profil',
      type: 'COGS',
      amountGross: '25.00',
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
      amountGross: '25.00',
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
      amountGross: '10.00',
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

    const { user } = render(
      <CostCellPopover orgId={ORG_ID} variantId={VARIANT_ID}>
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

    const { user } = render(
      <CostCellPopover orgId={ORG_ID} variantId={VARIANT_ID}>
        <button type="button">Open</button>
      </CostCellPopover>,
    );

    await user.click(screen.getByRole('button', { name: 'Open' }));

    await waitFor(() => {
      // The attached profile should appear in the list (not in the search results)
      expect(screen.getByText('COGS Profil')).toBeInTheDocument();
    });

    // The flat cmdk search input is always rendered inside the panel. Its
    // placeholder is products.costCell.popover.searchPlaceholder.
    const searchInput = screen.getByPlaceholderText('Profil ara veya seç…');
    await user.click(searchInput);

    await waitFor(() => {
      // Only the non-attached profile appears in the search results.
      expect(screen.getByText('Paketleme')).toBeInTheDocument();
    });
  });

  it('clicking the "Yeni profil oluştur" footer closes popover and opens create dialog', async () => {
    server.use(
      http.get(
        `${TEST_API_BASE}/v1/organizations/${ORG_ID}/variants/${VARIANT_ID}/cost-profiles`,
        () => HttpResponse.json({ data: [] }),
      ),
      http.get(`${TEST_API_BASE}/v1/organizations/${ORG_ID}/cost-profiles`, () =>
        HttpResponse.json({ data: [], meta: { nextCursor: null, hasMore: false } }),
      ),
    );

    const { user } = render(
      <CostCellPopover orgId={ORG_ID} variantId={VARIANT_ID}>
        <button type="button">Open</button>
      </CostCellPopover>,
    );

    await user.click(screen.getByRole('button', { name: 'Open' }));

    // The "+" is a PlusSignIcon; the footer label is products.costCell.popover.newProfile.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Yeni profil oluştur' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Yeni profil oluştur' }));

    // Create dialog should open (title from costs.createDialog.title in tr.json)
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

    const { user } = render(
      <CostCellPopover orgId={ORG_ID} variantId={VARIANT_ID}>
        <button type="button">Open</button>
      </CostCellPopover>,
    );

    await user.click(screen.getByRole('button', { name: 'Open' }));

    await waitFor(() => {
      expect(screen.getByText('COGS Profil')).toBeInTheDocument();
    });

    // The remove button's aria-label is products.costCell.popover.removeLabel
    // interpolated with the profile name: "{name} profilini kaldır".
    await user.click(screen.getByRole('button', { name: 'COGS Profil profilini kaldır' }));

    await waitFor(() => {
      expect(detachCalled).toBe(true);
    });
  });
});
