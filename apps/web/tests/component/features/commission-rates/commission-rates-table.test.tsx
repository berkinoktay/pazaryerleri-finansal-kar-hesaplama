import { describe, expect, it, vi } from 'vitest';

import { CommissionRatesTable } from '@/features/commission-rates/components/commission-rates-table';
import type { CommissionRateListItem } from '@/features/commission-rates/api/list-commission-rates.api';
import { TooltipProvider } from '@/components/ui/tooltip';

import { render, screen } from '../../../helpers/render';

function makeRow(overrides: Partial<CommissionRateListItem> = {}): CommissionRateListItem {
  return {
    id: 'r-1',
    ruleKind: 'CATEGORY',
    platform: 'TRENDYOL',
    categoryId: '411',
    brandId: null,
    categoryName: 'Casual Ayakkabı',
    parentCategoryName: 'Günlük Ayakkabı',
    brandName: null,
    baseRate: '5.00',
    paymentTermDays: 14,
    segmentOverrides: {},
    productCount: 0,
    fetchedAt: '2026-05-12T08:23:01.000Z',
    ...overrides,
  };
}

const baseProps = {
  ruleKind: 'CATEGORY' as const,
  productScope: 'all' as const,
  sort: 'category_name:asc' as const,
  loading: false,
  page: 1,
  perPage: 50,
  total: 1,
  totalPages: 1,
  onPaginationChange: vi.fn(),
  onSortChange: vi.fn(),
};

describe('CommissionRatesTable — segment tooltip', () => {
  it('renders the baseRate without an info icon when segmentOverrides is empty', () => {
    render(
      <TooltipProvider>
        <CommissionRatesTable {...baseProps} rows={[makeRow({ segmentOverrides: {} })]} />
      </TooltipProvider>,
    );
    // The percent value renders without a trigger button when no overrides exist.
    // We assert the percent is present and that no button containing it exists.
    const percentText = screen.getByText('%5,0');
    expect(percentText).toBeInTheDocument();
    // Assert it's not inside a button role
    expect(percentText.closest('[role="button"]')).toBeNull();
  });

  it('renders the info trigger when at least one override is present', () => {
    render(
      <TooltipProvider>
        <CommissionRatesTable
          {...baseProps}
          rows={[makeRow({ segmentOverrides: { ka1: '4.00' } })]}
        />
      </TooltipProvider>,
    );
    const percentText = screen.getByText('%5,0');
    expect(percentText).toBeInTheDocument();
    // Assert it IS wrapped in a button role
    const trigger = percentText.closest('[role="button"]');
    expect(trigger).not.toBeNull();
  });
});

describe('CommissionRatesTable — column shape by ruleKind', () => {
  it('shows the Üst Kategori column for CATEGORY', () => {
    render(
      <TooltipProvider>
        <CommissionRatesTable
          {...baseProps}
          rows={[makeRow({ parentCategoryName: 'Günlük Ayakkabı' })]}
        />
      </TooltipProvider>,
    );
    expect(screen.getByText('Üst Kategori')).toBeInTheDocument();
    expect(screen.queryByText('Marka')).not.toBeInTheDocument();
  });

  it('shows the Marka column for CATEGORY_BRAND', () => {
    render(
      <TooltipProvider>
        <CommissionRatesTable
          {...baseProps}
          ruleKind="CATEGORY_BRAND"
          rows={[
            makeRow({
              ruleKind: 'CATEGORY_BRAND',
              parentCategoryName: null,
              brandName: 'Reebok',
              brandId: '16',
            }),
          ]}
        />
      </TooltipProvider>,
    );
    expect(screen.getByText('Marka')).toBeInTheDocument();
    expect(screen.queryByText('Üst Kategori')).not.toBeInTheDocument();
  });
});
