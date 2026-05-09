import { describe, expect, it } from 'vitest';

import { CostProfileVersionDiff } from '@/features/costs/components/cost-profile-version-diff';

import type { CostProfileVersion } from '@/features/costs/types/cost-profile.types';

import { render, screen } from '../../../helpers/render';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const V1: CostProfileVersion = {
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

const V2: CostProfileVersion = {
  ...V1,
  id: 'v2-id',
  version: 2,
  amount: '30.00',
  changedFields: ['amount', 'name'],
  changedBy: 'user-abc-123',
  changedAt: '2026-04-15T14:30:00Z',
  name: 'Hammadde COGS — güncel',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CostProfileVersionDiff', () => {
  it('shows "İlk değer" label for all fields on version 1', () => {
    render(
      <CostProfileVersionDiff
        open={true}
        onOpenChange={() => undefined}
        version={V1}
        previousVersion={null}
      />,
    );
    // Multiple "İlk değer" badges — one per non-null field
    const badges = screen.getAllByText('İlk değer');
    expect(badges.length).toBeGreaterThan(0);
  });

  it('shows sheet title with version number', () => {
    render(
      <CostProfileVersionDiff
        open={true}
        onOpenChange={() => undefined}
        version={V1}
        previousVersion={null}
      />,
    );
    expect(screen.getByText('v1 değişiklikleri')).toBeInTheDocument();
  });

  it('shows before/after rows for v2 changedFields', () => {
    render(
      <CostProfileVersionDiff
        open={true}
        onOpenChange={() => undefined}
        version={V2}
        previousVersion={V1}
      />,
    );
    // "Önce" and "Sonra" labels appear for each changed field pair
    const beforeLabels = screen.getAllByText('Önce');
    const afterLabels = screen.getAllByText('Sonra');
    expect(beforeLabels.length).toBe(2); // amount + name
    expect(afterLabels.length).toBe(2);
  });

  it('shows the previous amount value in the before column', () => {
    render(
      <CostProfileVersionDiff
        open={true}
        onOpenChange={() => undefined}
        version={V2}
        previousVersion={V1}
      />,
    );
    expect(screen.getByText('25.50')).toBeInTheDocument();
    expect(screen.getByText('30.00')).toBeInTheDocument();
  });

  it('does not render when open is false', () => {
    render(
      <CostProfileVersionDiff
        open={false}
        onOpenChange={() => undefined}
        version={V1}
        previousVersion={null}
      />,
    );
    expect(screen.queryByText('v1 değişiklikleri')).not.toBeInTheDocument();
  });
});
