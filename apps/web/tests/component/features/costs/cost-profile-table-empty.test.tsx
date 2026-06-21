import { render, screen } from '@testing-library/react';
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

function renderTable(overrides?: { data?: CostProfile[]; q?: string }): void {
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
        showArchived={false}
        typeFilter=""
        onSearchChange={vi.fn()}
        onShowArchivedChange={vi.fn()}
        onTypeFilterChange={vi.fn()}
        onEditClick={vi.fn()}
        onArchiveClick={vi.fn()}
        onRestoreClick={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
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
    // The table uses manual filtering, so the no-results body is reached when an
    // active search returns no rows. It must read as "no matches" (clear search),
    // never as the "create your first profile" first-run CTA.
    renderTable({ data: [], q: 'zzz-no-such-profile' });

    expect(screen.getByText(messages.common.dataTable.noResults.title)).toBeInTheDocument();
    expect(screen.queryByText(messages.costs.empty.title)).toBeNull();
  });
});
