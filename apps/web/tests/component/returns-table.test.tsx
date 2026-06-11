import { describe, expect, it, vi } from 'vitest';

import type { ClaimListItem } from '@/features/returns/api/list-claims.api';
import { ReturnsTable } from '@/features/returns/components/returns-table';

import { render, screen } from '../helpers/render';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const PAGINATION = { page: 1, perPage: 25, total: 1, totalPages: 1 };
const FILTERS = { q: '', from: '', to: '' };
const COUNTS = { all: 1, open: 0, resolved: 1 };

function makeRow(overrides: Partial<ClaimListItem> = {}): ClaimListItem {
  return {
    id: 'c1',
    orderId: 'o1',
    platformOrderNumber: '11101228439',
    trendyolClaimId: 't1',
    claimDate: '2026-06-10T10:00:00.000Z',
    resolved: true,
    derivedStatus: 'ACCEPTED',
    scope: 'FULL',
    itemCount: 2,
    productSummary: { firstName: 'Kemer', units: 2, otherCount: 1 },
    reasonSummary: { first: 'Yanlış ürün', otherCount: 1 },
    cargoProviderName: null,
    cargoTrackingNumber: null,
    ...overrides,
  };
}

describe('ReturnsTable', () => {
  it('renders claim rows with badges and "+N" overflow summaries', () => {
    render(
      <ReturnsTable
        rows={[makeRow()]}
        loading={false}
        pagination={PAGINATION}
        filters={FILTERS}
        status="all"
        counts={COUNTS}
        onStatusChange={() => undefined}
        onFiltersChange={() => undefined}
        onPaginationChange={() => undefined}
      />,
    );

    expect(screen.getByText('11101228439')).toBeInTheDocument();
    expect(screen.getByText('Kemer')).toBeInTheDocument();
    // ürün + sebep taşmaları — her ikisi de "+1"
    expect(screen.getAllByText('+1')).toHaveLength(2);
    expect(screen.getByText('Kabul edildi')).toBeInTheDocument();
    // scope FULL rozeti ("Tümü" tab etiketiyle çakışmasın diye getAllBy)
    expect(screen.getAllByText('Tümü').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('×2')).toBeInTheDocument();
  });

  it('falls back to the unknown-product label when claim items are unlinked', () => {
    render(
      <ReturnsTable
        rows={[
          makeRow({
            productSummary: { firstName: null, units: 1, otherCount: 0 },
            reasonSummary: { first: 'Hasarlı ürün', otherCount: 0 },
            derivedStatus: 'OPEN',
            scope: 'PARTIAL',
            resolved: false,
          }),
        ]}
        loading={false}
        pagination={PAGINATION}
        filters={FILTERS}
        status="all"
        counts={COUNTS}
        onStatusChange={() => undefined}
        onFiltersChange={() => undefined}
        onPaginationChange={() => undefined}
      />,
    );

    expect(screen.getByText('Bilinmeyen ürün')).toBeInTheDocument();
    // "Açık" hem tab etiketi hem OPEN rozeti — 2+ eşleşme rozetin varlığını kanıtlar
    expect(screen.getAllByText('Açık').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Parçalı')).toBeInTheDocument();
  });
});
