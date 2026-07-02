import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NuqsAdapter } from 'nuqs/adapters/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/products',
  useSearchParams: () => new URLSearchParams(),
}));

import { useProductsFilters } from '@/features/products/hooks/use-products-filters';

import { render, screen } from '@/../tests/helpers/render';

// Tiny harness component that exercises the hook through the rendered
// DOM — keeps assertions focused on user-observable behavior rather
// than poking at returned values directly.
function FilterHarness(): React.ReactElement {
  const { filters, setFilters } = useProductsFilters();
  return (
    <div>
      <p data-testid="filters">{filters.filters.map((row) => row.field).join(',')}</p>
      <p data-testid="page">{filters.page.toString()}</p>
      <p data-testid="perPage">{filters.perPage.toString()}</p>
      <p data-testid="overrideMissing">{filters.overrideMissing ?? 'null'}</p>
      <p data-testid="sort">{filters.sort}</p>
      <button onClick={() => void setFilters({ page: 4 })}>jump-to-4</button>
      <button
        onClick={() =>
          void setFilters({
            filters: [{ id: 'r-status', field: 'status', operator: 'eq', value: 'archived' }],
          })
        }
      >
        add-status-chip
      </button>
      <button onClick={() => void setFilters({ overrideMissing: 'cost' })}>missing-cost</button>
      <button onClick={() => void setFilters({ overrideMissing: null })}>clear-override</button>
      <button onClick={() => void setFilters({ sort: '-salePrice' })}>sort-desc-price</button>
    </div>
  );
}

function renderHarness() {
  return render(
    <NuqsAdapter>
      <FilterHarness />
    </NuqsAdapter>,
  );
}

describe('useProductsFilters', () => {
  it('exposes the documented defaults when no URL params are present', () => {
    renderHarness();
    expect(screen.getByTestId('filters').textContent).toBe('');
    expect(screen.getByTestId('page').textContent).toBe('1');
    expect(screen.getByTestId('perPage').textContent).toBe('25');
  });

  it('updates `page` when only pagination changes — does NOT reset to 1', async () => {
    const { user } = renderHarness();
    await user.click(screen.getByText('jump-to-4'));
    expect(screen.getByTestId('page').textContent).toBe('4');
  });

  it('resets `page` to 1 when an advanced-filter chip is added', async () => {
    const { user } = renderHarness();
    await user.click(screen.getByText('jump-to-4'));
    expect(screen.getByTestId('page').textContent).toBe('4');

    await user.click(screen.getByText('add-status-chip'));
    expect(screen.getByTestId('filters').textContent).toBe('status');
    expect(screen.getByTestId('page').textContent).toBe('1');
  });

  it('round-trips overrideMissing through state — null → cost → null', async () => {
    const { user } = renderHarness();
    expect(screen.getByTestId('overrideMissing').textContent).toBe('null');

    await user.click(screen.getByText('missing-cost'));
    expect(screen.getByTestId('overrideMissing').textContent).toBe('cost');

    await user.click(screen.getByText('clear-override'));
    expect(screen.getByTestId('overrideMissing').textContent).toBe('null');
  });

  it('accepts the extended sort vocabulary (e.g. -salePrice)', async () => {
    const { user } = renderHarness();
    // Default matches the Trendyol seller-panel ordering — newest listings first.
    expect(screen.getByTestId('sort').textContent).toBe('-platformCreatedAt');

    await user.click(screen.getByText('sort-desc-price'));
    expect(screen.getByTestId('sort').textContent).toBe('-salePrice');
  });
});
