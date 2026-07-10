import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { CostProfileEmptyState } from '@/features/costs/components/cost-profile-empty-state';
import { CostProfileTable } from '@/features/costs/components/cost-profile-table';
import type { CostProfile } from '@/features/costs/types/cost-profile.types';

import messages from '../../../../messages/tr.json';
import { FORMATS } from '../../../../src/i18n/formats';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function makeProfile(
  overrides: Partial<CostProfile> & Pick<CostProfile, 'id' | 'name'>,
): CostProfile {
  return {
    organizationId: 'org-1',
    storeId: 'store-1',
    type: 'COGS',
    amountGross: '10.00',
    currency: 'TRY',
    vatRate: 20,
    fxRateMode: 'AUTO',
    manualFxRate: null,
    note: null,
    archivedAt: null,
    createdBy: null,
    updatedBy: null,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

function renderTable(overrides?: {
  data?: CostProfile[];
  q?: string;
  hasActiveFilters?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
}): { user: ReturnType<typeof userEvent.setup> } {
  const user = userEvent.setup();
  render(
    <NextIntlClientProvider
      locale="tr"
      messages={messages}
      formats={FORMATS}
      timeZone="Europe/Istanbul"
    >
      <CostProfileTable
        data={overrides?.data ?? []}
        loading={false}
        empty={<CostProfileEmptyState onCreateClick={vi.fn()} />}
        q={overrides?.q ?? ''}
        onSearchChange={vi.fn()}
        advancedFilter={{ fields: [], value: [], onApply: vi.fn() }}
        hasActiveFilters={overrides?.hasActiveFilters ?? (overrides?.q ?? '').length > 0}
        onClearFilters={vi.fn()}
        hasMore={overrides?.hasMore}
        onLoadMore={overrides?.onLoadMore}
        onEditClick={vi.fn()}
        onArchiveClick={vi.fn()}
        onRestoreClick={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
  return { user };
}

describe('CostProfileTable empty body', () => {
  it('renders the table chrome with the embedded empty state (and its create CTA) when there are no profiles', () => {
    renderTable();

    // Chrome stays mounted — headers render even with zero profiles, so the page
    // no longer collapses into a bare full-page takeover (the regression we fixed).
    expect(screen.getAllByRole('columnheader').length).toBeGreaterThan(0);
    // The embedded empty body and its "create first profile" CTA render INSIDE
    // the table body.
    expect(screen.getByText(messages.costs.empty.title)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: messages.costs.empty.action })).toBeInTheDocument();
  });

  it('shows the no-results (clear search) state — not the create CTA — when a search is active but nothing matches', () => {
    // The parent pre-filters by name and signals hasActiveFilters; a zero-row
    // filtered view must read as "no matches" (clear filters), never as the
    // "create your first profile" first-run CTA.
    renderTable({ data: [], q: 'zzz-no-such-profile' });

    expect(screen.getByText(messages.common.dataTable.noResults.title)).toBeInTheDocument();
    expect(screen.queryByText(messages.costs.empty.title)).toBeNull();
  });

  it('shows the no-results state when only server-side chips filter to zero (no search text)', () => {
    // Type/archived chips are server params — invisible to columnFilters. The
    // combined hasActiveFilters signal must still resolve the zero-row body to
    // no-results (this was the review's warning finding).
    renderTable({ data: [], hasActiveFilters: true });

    expect(screen.getByText(messages.common.dataTable.noResults.title)).toBeInTheDocument();
    expect(screen.queryByText(messages.costs.empty.title)).toBeNull();
  });
});

describe('CostProfileTable cursor pagination', () => {
  it('renders EVERY loaded row — no client-side 10-row slice (the load-more blocker)', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      makeProfile({ id: `p-${i.toString()}`, name: `Profil ${i.toString()}` }),
    );
    renderTable({ data: many });

    // 12 data rows + 1 header row — uncontrolled DataTable used to slice at 10.
    expect(screen.getAllByRole('row')).toHaveLength(13);
  });

  it('renders the load-more footer only while more pages exist and it fires onLoadMore', async () => {
    const onLoadMore = vi.fn();
    const { user } = renderTable({
      data: [makeProfile({ id: 'p-1', name: 'Tek profil' })],
      hasMore: true,
      onLoadMore,
    });

    await user.click(screen.getByRole('button', { name: messages.costs.table.loadMore }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });
});
