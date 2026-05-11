import { NextIntlClientProvider } from 'next-intl';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { CostProfileHistoryList } from '@/features/costs/components/cost-profile-history-list';

import type { CostProfileVersion } from '@/features/costs/types/cost-profile.types';

import { FORMATS } from '../../../../src/i18n/formats';
import trMessages from '../../../../messages/tr.json';
import { render, screen, createTestQueryClient } from '../../../helpers/render';
import { QueryClientProvider } from '@tanstack/react-query';

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

// ─── Fixtures ────────────────────────────────────────────────────────────────

const BASE_VERSION: CostProfileVersion = {
  id: 'v1-id',
  profileId: 'profile-1',
  organizationId: 'org-1',
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
};

const V2_VERSION: CostProfileVersion = {
  ...BASE_VERSION,
  id: 'v2-id',
  version: 2,
  amount: '30.00',
  changedFields: ['amount'],
  changedBy: 'user-abc-123',
  changedAt: '2026-04-15T14:30:00Z',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CostProfileHistoryList', () => {
  it('shows empty state when versions array is empty', () => {
    renderWithIntl(<CostProfileHistoryList versions={[]} isLoading={false} />);
    expect(screen.getByText('Geçmiş kaydı yok')).toBeInTheDocument();
  });

  it('shows skeleton while loading', () => {
    renderWithIntl(<CostProfileHistoryList versions={[]} isLoading={true} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders an event label and relative time for v1', () => {
    renderWithIntl(<CostProfileHistoryList versions={[BASE_VERSION]} isLoading={false} />);
    expect(screen.getByText('Oluşturuldu')).toBeInTheDocument();
    // The relative time component renders an absolute date on SSR/first paint
    expect(screen.getByRole('time')).toBeInTheDocument();
  });

  it('renders every non-null initial field for version 1 with the new value', () => {
    renderWithIntl(<CostProfileHistoryList versions={[BASE_VERSION]} isLoading={false} />);
    // Initial create row shows the field label and the value
    expect(screen.getByText('Ad')).toBeInTheDocument();
    expect(screen.getByText('Hammadde COGS')).toBeInTheDocument();
    expect(screen.getByText('Tutar')).toBeInTheDocument();
    expect(screen.getByText('25.50')).toBeInTheDocument();
  });

  it('renders inline before → after diff for an UPDATED event', () => {
    renderWithIntl(
      <CostProfileHistoryList versions={[V2_VERSION, BASE_VERSION]} isLoading={false} />,
    );
    expect(screen.getByText('Düzenlendi')).toBeInTheDocument();
    // amount diff: "25.50" (old) and "30.00" (new) both visible on v2's row
    expect(screen.getByText('25.50')).toBeInTheDocument();
    expect(screen.getByText('30.00')).toBeInTheDocument();
  });

  it('classifies archive event when only archivedAt was set', () => {
    const archived: CostProfileVersion = {
      ...BASE_VERSION,
      id: 'v2-archive',
      version: 2,
      archivedAt: '2026-04-20T12:00:00Z',
      changedFields: ['archivedAt'],
      changedAt: '2026-04-20T12:00:00Z',
    };
    renderWithIntl(
      <CostProfileHistoryList versions={[archived, BASE_VERSION]} isLoading={false} />,
    );
    expect(screen.getByText('Arşivlendi')).toBeInTheDocument();
  });

  it('classifies restore event when archivedAt was cleared', () => {
    const restored: CostProfileVersion = {
      ...BASE_VERSION,
      id: 'v3-restore',
      version: 3,
      archivedAt: null,
      changedFields: ['archivedAt'],
      changedAt: '2026-04-21T09:00:00Z',
    };
    renderWithIntl(
      <CostProfileHistoryList versions={[restored, BASE_VERSION]} isLoading={false} />,
    );
    expect(screen.getByText('Geri yüklendi')).toBeInTheDocument();
  });

  it('renders "Sistem" for null changedBy', () => {
    renderWithIntl(<CostProfileHistoryList versions={[BASE_VERSION]} isLoading={false} />);
    expect(screen.getByText('Sistem')).toBeInTheDocument();
  });
});
