import { NextIntlClientProvider } from 'next-intl';
import * as React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { MissingCostWarningBanner } from '@/features/products/components/missing-cost-warning-banner';
import { FORMATS } from '@/i18n/formats';

import { render, screen, createTestQueryClient } from '../../../helpers/render';
import { server, http, HttpResponse } from '../../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const TEST_API_BASE = 'http://localhost:3001';

const MESSAGES = {
  products: {
    missingCostBanner: {
      title: 'Maliyetsiz {count} ürün — kâr hesabı yapılamıyor.',
      description: 'Eksik maliyetleri tamamla.',
      cta: 'Maliyetsiz ürünleri filtrele',
    },
  },
};

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <NextIntlClientProvider
        locale="tr"
        messages={MESSAGES}
        formats={FORMATS}
        timeZone="Europe/Istanbul"
      >
        {children}
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

function renderBanner(props: { orgId: string | null; onFilterClick: () => void }) {
  return render(<MissingCostWarningBanner {...props} />, { wrapper: Wrapper });
}

describe('MissingCostWarningBanner', () => {
  it('renders nothing when orgId is null', async () => {
    const { container } = renderBanner({ orgId: null, onFilterClick: vi.fn() });
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when count is 0', async () => {
    server.use(
      http.get(`${TEST_API_BASE}/v1/organizations/${ORG_ID}/products/missing-cost-stats`, () =>
        HttpResponse.json({ count: 0, totalVariants: 100, byStore: [] }),
      ),
    );
    const { container } = renderBanner({ orgId: ORG_ID, onFilterClick: vi.fn() });
    // Wait for query to settle
    await new Promise((r) => setTimeout(r, 50));
    expect(container.firstChild).toBeNull();
  });

  it('renders banner with count and CTA when count > 0', async () => {
    server.use(
      http.get(`${TEST_API_BASE}/v1/organizations/${ORG_ID}/products/missing-cost-stats`, () =>
        HttpResponse.json({ count: 7, totalVariants: 50, byStore: [] }),
      ),
    );
    renderBanner({ orgId: ORG_ID, onFilterClick: vi.fn() });
    const alert = await screen.findByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent('7');
    expect(
      screen.getByRole('button', { name: 'Maliyetsiz ürünleri filtrele' }),
    ).toBeInTheDocument();
  });

  it('calls onFilterClick when CTA button is clicked', async () => {
    const onFilterClick = vi.fn();
    server.use(
      http.get(`${TEST_API_BASE}/v1/organizations/${ORG_ID}/products/missing-cost-stats`, () =>
        HttpResponse.json({ count: 3, totalVariants: 30, byStore: [] }),
      ),
    );
    const { user } = renderBanner({ orgId: ORG_ID, onFilterClick });
    const btn = await screen.findByRole('button', { name: 'Maliyetsiz ürünleri filtrele' });
    await user.click(btn);
    expect(onFilterClick).toHaveBeenCalledOnce();
  });
});
