import { NextIntlClientProvider } from 'next-intl';
import * as React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { MissingCostWarningBanner } from '@/features/products/components/missing-cost-warning-banner';
import { FORMATS } from '@/i18n/formats';

import { render, screen, createTestQueryClient } from '../../../helpers/render';
import { server, http, HttpResponse } from '../../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const STORE_ID = '00000000-0000-0000-0000-0000000000a1';
const OTHER_STORE_ID = '00000000-0000-0000-0000-0000000000b2';
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

function renderBanner(props: { orgId: string | null; storeId: string; onFilterClick: () => void }) {
  return render(<MissingCostWarningBanner {...props} />, { wrapper: Wrapper });
}

function mockStats(
  byStore: { storeId: string; missingCount: number; totalVariants: number }[],
): void {
  const count = byStore.reduce((sum, s) => sum + s.missingCount, 0);
  const totalVariants = byStore.reduce((sum, s) => sum + s.totalVariants, 0);
  server.use(
    http.get(`${TEST_API_BASE}/v1/organizations/${ORG_ID}/products/missing-cost-stats`, () =>
      HttpResponse.json({ count, totalVariants, byStore }),
    ),
  );
}

describe('MissingCostWarningBanner', () => {
  it('renders nothing when orgId is null', async () => {
    const { container } = renderBanner({ orgId: null, storeId: STORE_ID, onFilterClick: vi.fn() });
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the active store has 0 missing (even if another store has missing)', async () => {
    // Active store clean; a SIBLING store has missing variants. The banner must
    // stay hidden — the org-wide count is non-zero but this store's is 0.
    mockStats([
      { storeId: STORE_ID, missingCount: 0, totalVariants: 100 },
      { storeId: OTHER_STORE_ID, missingCount: 9, totalVariants: 40 },
    ]);
    const { container } = renderBanner({
      orgId: ORG_ID,
      storeId: STORE_ID,
      onFilterClick: vi.fn(),
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(container.firstChild).toBeNull();
  });

  it('shows ONLY the active store count, never the org-wide sum', async () => {
    // Active store missing 7; sibling store missing 100. The banner must show 7,
    // not 107 — the count must agree with the CTA that filters only this store.
    mockStats([
      { storeId: STORE_ID, missingCount: 7, totalVariants: 50 },
      { storeId: OTHER_STORE_ID, missingCount: 100, totalVariants: 200 },
    ]);
    renderBanner({ orgId: ORG_ID, storeId: STORE_ID, onFilterClick: vi.fn() });
    const alert = await screen.findByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent('7');
    expect(alert).not.toHaveTextContent('107');
    expect(
      screen.getByRole('button', { name: 'Maliyetsiz ürünleri filtrele' }),
    ).toBeInTheDocument();
  });

  it('calls onFilterClick when CTA button is clicked', async () => {
    const onFilterClick = vi.fn();
    mockStats([{ storeId: STORE_ID, missingCount: 3, totalVariants: 30 }]);
    const { user } = renderBanner({ orgId: ORG_ID, storeId: STORE_ID, onFilterClick });
    const btn = await screen.findByRole('button', { name: 'Maliyetsiz ürünleri filtrele' });
    await user.click(btn);
    expect(onFilterClick).toHaveBeenCalledOnce();
  });
});
