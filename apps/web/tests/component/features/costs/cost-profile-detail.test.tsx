import { NextIntlClientProvider } from 'next-intl';
import * as React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { CostProfileDetail } from '@/features/costs/components/cost-profile-detail';

import { FORMATS } from '../../../../src/i18n/formats';
import trMessages from '../../../../messages/tr.json';
import { render, screen, waitFor, createTestQueryClient } from '../../../helpers/render';
import { server, http, HttpResponse } from '../../../helpers/msw';

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <NextIntlClientProvider
        locale="tr"
        messages={trMessages}
        formats={FORMATS}
        timeZone="Europe/Istanbul"
      >
        {children}
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

function renderWithIntl(ui: React.ReactElement) {
  return render(ui, { wrapper: Wrapper });
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const PROFILE_ID = 'profile-uuid-0001';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const MOCK_PROFILE = {
  id: PROFILE_ID,
  organizationId: ORG_ID,
  name: 'Hammadde COGS',
  type: 'COGS',
  amount: '25.50',
  currency: 'TRY',
  vatRate: 18,
  fxRateMode: 'AUTO',
  manualFxRate: null,
  note: null,
  archivedAt: null,
  createdBy: null,
  updatedBy: null,
  createdAt: '2026-04-01T10:00:00Z',
  updatedAt: '2026-04-01T10:00:00Z',
};

const MOCK_VERSIONS_RESPONSE = {
  data: [
    {
      id: 'v1-id',
      profileId: PROFILE_ID,
      organizationId: ORG_ID,
      version: 1,
      name: 'Hammadde COGS',
      type: 'COGS',
      amount: '25.50',
      currency: 'TRY',
      vatRate: 18,
      fxRateMode: 'AUTO',
      manualFxRate: null,
      note: null,
      archivedAt: null,
      changedFields: [],
      changedBy: null,
      changedAt: '2026-04-01T10:00:00Z',
      changeReason: null,
    },
  ],
  meta: { cursor: null, hasMore: false, total: 1 },
};

const MOCK_VARIANTS_RESPONSE = {
  data: [],
  meta: { cursor: null, hasMore: false, total: 0 },
};

const MOCK_FX_RATES = { USD: null, EUR: null };

// ─── Default MSW handlers for the detail page ────────────────────────────────

function setupDefaultHandlers() {
  server.use(
    http.get(`http://localhost:3001/v1/organizations/${ORG_ID}/cost-profiles/${PROFILE_ID}`, () =>
      HttpResponse.json(MOCK_PROFILE),
    ),
    http.get(
      `http://localhost:3001/v1/organizations/${ORG_ID}/cost-profiles/${PROFILE_ID}/versions`,
      () => HttpResponse.json(MOCK_VERSIONS_RESPONSE),
    ),
    http.get(
      `http://localhost:3001/v1/organizations/${ORG_ID}/cost-profiles/${PROFILE_ID}/attached-variants`,
      () => HttpResponse.json(MOCK_VARIANTS_RESPONSE),
    ),
    http.get(`http://localhost:3001/v1/organizations/${ORG_ID}/fx-rates/latest`, () =>
      HttpResponse.json(MOCK_FX_RATES),
    ),
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CostProfileDetail', () => {
  it('renders the profile name in the page header once loaded', async () => {
    setupDefaultHandlers();
    renderWithIntl(<CostProfileDetail orgId={ORG_ID} profileId={PROFILE_ID} />);
    expect(await screen.findByRole('heading', { name: 'Hammadde COGS' })).toBeInTheDocument();
  });

  it('renders the three tabs: Detay, Geçmiş, Bağlı varyantlar', async () => {
    setupDefaultHandlers();
    renderWithIntl(<CostProfileDetail orgId={ORG_ID} profileId={PROFILE_ID} />);
    expect(await screen.findByRole('tab', { name: 'Detay' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Geçmiş' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Bağlı varyantlar' })).toBeInTheDocument();
  });

  it('shows the edit form (with save button) on the Detay tab', async () => {
    setupDefaultHandlers();
    renderWithIntl(<CostProfileDetail orgId={ORG_ID} profileId={PROFILE_ID} />);
    // Detay tab is active by default; form renders with a Kaydet button
    expect(await screen.findByRole('button', { name: 'Kaydet' })).toBeInTheDocument();
  });

  it('switches to the Geçmiş tab and shows history content', async () => {
    setupDefaultHandlers();
    const { user } = renderWithIntl(<CostProfileDetail orgId={ORG_ID} profileId={PROFILE_ID} />);
    await screen.findByRole('tab', { name: 'Geçmiş' });
    await user.click(screen.getByRole('tab', { name: 'Geçmiş' }));
    // The history timeline classifies version 1 as the "created" event and
    // renders its label (costs.detail.history.event.created) — not a "v1" string.
    expect(await screen.findByText('Oluşturuldu')).toBeInTheDocument();
  });

  it('switches to the Bağlı varyantlar tab and shows empty state', async () => {
    setupDefaultHandlers();
    const { user } = renderWithIntl(<CostProfileDetail orgId={ORG_ID} profileId={PROFILE_ID} />);
    await screen.findByRole('tab', { name: 'Bağlı varyantlar' });
    await user.click(screen.getByRole('tab', { name: 'Bağlı varyantlar' }));
    expect(await screen.findByText('Bağlı varyant yok')).toBeInTheDocument();
  });

  it('shows "Arşivle" action button for an active profile', async () => {
    setupDefaultHandlers();
    renderWithIntl(<CostProfileDetail orgId={ORG_ID} profileId={PROFILE_ID} />);
    expect(await screen.findByRole('button', { name: 'Arşivle' })).toBeInTheDocument();
  });

  it('shows "Geri yükle" action button for an archived profile', async () => {
    server.use(
      http.get(`http://localhost:3001/v1/organizations/${ORG_ID}/cost-profiles/${PROFILE_ID}`, () =>
        HttpResponse.json({ ...MOCK_PROFILE, archivedAt: '2026-05-01T12:00:00Z' }),
      ),
      http.get(
        `http://localhost:3001/v1/organizations/${ORG_ID}/cost-profiles/${PROFILE_ID}/versions`,
        () => HttpResponse.json(MOCK_VERSIONS_RESPONSE),
      ),
      http.get(
        `http://localhost:3001/v1/organizations/${ORG_ID}/cost-profiles/${PROFILE_ID}/attached-variants`,
        () => HttpResponse.json(MOCK_VARIANTS_RESPONSE),
      ),
      http.get(`http://localhost:3001/v1/organizations/${ORG_ID}/fx-rates/latest`, () =>
        HttpResponse.json(MOCK_FX_RATES),
      ),
    );
    renderWithIntl(<CostProfileDetail orgId={ORG_ID} profileId={PROFILE_ID} />);
    expect(await screen.findByRole('button', { name: 'Geri yükle' })).toBeInTheDocument();
  });

  it('calls the update API when the edit form is saved', async () => {
    setupDefaultHandlers();
    let updateCalled = false;

    server.use(
      http.patch(
        `http://localhost:3001/v1/organizations/${ORG_ID}/cost-profiles/${PROFILE_ID}`,
        async () => {
          updateCalled = true;
          return HttpResponse.json({ ...MOCK_PROFILE, name: 'Hammadde COGS — güncel' });
        },
      ),
    );

    const { user } = renderWithIntl(<CostProfileDetail orgId={ORG_ID} profileId={PROFILE_ID} />);

    // Wait for form to load then submit
    await screen.findByRole('button', { name: 'Kaydet' });
    await user.click(screen.getByRole('button', { name: 'Kaydet' }));

    await waitFor(() => {
      expect(updateCalled).toBe(true);
    });
  });
});
