import { NextIntlClientProvider } from 'next-intl';
import * as React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

// CostProfileAttachedVariants renders next-intl's <Link>, which pulls in
// next-intl's createNavigation → `next/navigation`. That module doesn't
// resolve under vitest/happy-dom, so we stub the navigation layer the same
// way cost-profile-detail.test.tsx does.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}));

import { CostProfileAttachedVariants } from '@/features/costs/components/cost-profile-attached-variants';

import type { AttachedVariant } from '@/features/costs/types/cost-profile.types';

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

const VARIANT_1: AttachedVariant = {
  linkId: 'link-1',
  productVariantId: 'variant-1',
  barcode: '8680000000001',
  stockCode: 'SKU-001',
  productId: 'product-1',
  productTitle: 'Pamuklu T-Shirt',
  productImageUrl: null,
  attachedAt: '2026-04-01T10:00:00Z',
  attachedBy: null,
};

const VARIANT_2: AttachedVariant = {
  linkId: 'link-2',
  productVariantId: 'variant-2',
  barcode: '8680000000002',
  stockCode: 'SKU-002',
  productId: 'product-2',
  productTitle: 'Denim Pantolon',
  productImageUrl: null,
  attachedAt: '2026-04-10T09:00:00Z',
  attachedBy: 'user-abc',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CostProfileAttachedVariants', () => {
  it('shows empty state when no variants are attached', () => {
    renderWithIntl(
      <CostProfileAttachedVariants
        orgId={ORG_ID}
        profileId={PROFILE_ID}
        variants={[]}
        isLoading={false}
      />,
    );
    expect(screen.getByText('Bağlı varyant yok')).toBeInTheDocument();
  });

  it('shows skeleton while loading', () => {
    renderWithIntl(
      <CostProfileAttachedVariants
        orgId={ORG_ID}
        profileId={PROFILE_ID}
        variants={[]}
        isLoading={true}
      />,
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders a row for each attached variant with product title and stock code', () => {
    renderWithIntl(
      <CostProfileAttachedVariants
        orgId={ORG_ID}
        profileId={PROFILE_ID}
        variants={[VARIANT_1, VARIANT_2]}
        isLoading={false}
      />,
    );
    expect(screen.getByText('Pamuklu T-Shirt')).toBeInTheDocument();
    expect(screen.getByText('SKU-001')).toBeInTheDocument();
    expect(screen.getByText('Denim Pantolon')).toBeInTheDocument();
    expect(screen.getByText('SKU-002')).toBeInTheDocument();
  });

  it('renders a detach button per variant', () => {
    renderWithIntl(
      <CostProfileAttachedVariants
        orgId={ORG_ID}
        profileId={PROFILE_ID}
        variants={[VARIANT_1, VARIANT_2]}
        isLoading={false}
      />,
    );
    // Each detach button has visible text "Ayır" — find by text content
    const detachButtons = screen.getAllByText('Ayır');
    expect(detachButtons).toHaveLength(2);
  });

  it('calls the detach API when the detach button is clicked', async () => {
    let capturedBody: unknown = null;

    server.use(
      http.post(
        `http://localhost:3001/v1/organizations/${ORG_ID}/cost-profile-attachments/detach`,
        async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({ detached: 1 });
        },
      ),
    );

    const { user } = renderWithIntl(
      <CostProfileAttachedVariants
        orgId={ORG_ID}
        profileId={PROFILE_ID}
        variants={[VARIANT_1]}
        isLoading={false}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'SKU-001 varyantını ayır' }));

    await waitFor(() => {
      expect(capturedBody).toEqual({
        profileIds: [PROFILE_ID],
        variantIds: ['variant-1'],
      });
    });
  });
});
