import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NuqsTestingAdapter, type OnUrlUpdateFunction } from 'nuqs/adapters/testing';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/products',
  useSearchParams: () => new URLSearchParams(),
}));

import { ProductVariantStatus } from '@pazarsync/db/enums';

import { useProductsFilters } from '@/features/products/hooks/use-products-filters';

import { render, screen } from '@/../tests/helpers/render';

// Tiny harness component that exercises the hook through the rendered
// DOM — keeps assertions focused on user-observable behavior rather
// than poking at returned values directly.
function FilterHarness(): React.ReactElement {
  const { filters, setFilters, replacePage } = useProductsFilters();
  return (
    <div>
      <p data-testid="filters">{filters.filters.map((row) => row.field).join(',')}</p>
      <p data-testid="filterValues">{filters.filters.map((row) => String(row.value)).join(',')}</p>
      <p data-testid="page">{filters.page.toString()}</p>
      <p data-testid="perPage">{filters.perPage.toString()}</p>
      <p data-testid="overrideMissing">{filters.overrideMissing ?? 'null'}</p>
      <p data-testid="sort">{filters.sort}</p>
      <button onClick={() => void setFilters({ page: 4 })}>jump-to-4</button>
      <button onClick={() => void replacePage(2)}>replace-page-2</button>
      <button
        onClick={() =>
          void setFilters({
            filters: [
              {
                id: 'r-status',
                field: 'status',
                operator: 'eq',
                value: ProductVariantStatus.ARCHIVED,
              },
            ],
          })
        }
      >
        add-status-chip
      </button>
      <button onClick={() => void setFilters({ overrideMissing: 'cost' })}>missing-cost</button>
      <button onClick={() => void setFilters({ overrideMissing: 'desi' })}>missing-desi</button>
      <button onClick={() => void setFilters({ overrideMissing: null })}>clear-override</button>
      <button onClick={() => void setFilters({ sort: '-salePrice' })}>sort-desc-price</button>
    </div>
  );
}

function renderHarness(searchParams?: Record<string, string>, onUrlUpdate?: OnUrlUpdateFunction) {
  return render(
    // Testing adapter: synchronous URL-state application with throttling off.
    // The plain react adapter queues history updates on a timer — on a slow
    // runner the flush can fire AFTER environment teardown and crash the run
    // with "location is not defined" (exactly what CI hit).
    <NuqsTestingAdapter searchParams={searchParams} rateLimitFactor={0} onUrlUpdate={onUrlUpdate}>
      <FilterHarness />
    </NuqsTestingAdapter>,
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

  // The page client corrects a page past the last one with replacePage. A
  // push would leave the empty page in history and Back would land on it
  // and trigger another correction.
  it('replacePage moves to the page with a history replace, not a push', async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    const { user } = renderHarness({ page: '5' }, onUrlUpdate);
    await user.click(screen.getByText('replace-page-2'));

    expect(screen.getByTestId('page').textContent).toBe('2');
    expect(onUrlUpdate).toHaveBeenCalledTimes(1);
    const [event] = onUrlUpdate.mock.calls[0] ?? [];
    expect(event?.searchParams.get('page')).toBe('2');
    expect(event?.options.history).toBe('replace');
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

  it('round-trips the missing-desi tab through state: null, desi, null', async () => {
    const { user } = renderHarness();
    await user.click(screen.getByText('jump-to-4'));

    await user.click(screen.getByText('missing-desi'));
    expect(screen.getByTestId('overrideMissing').textContent).toBe('desi');
    // Switching the override tab resets pagination like every filter change.
    expect(screen.getByTestId('page').textContent).toBe('1');

    await user.click(screen.getByText('clear-override'));
    expect(screen.getByTestId('overrideMissing').textContent).toBe('null');
  });

  it('reads the missing-desi tab from an overrideMissing=desi link', () => {
    renderHarness({ overrideMissing: 'desi' });
    expect(screen.getByTestId('overrideMissing').textContent).toBe('desi');
  });

  it('accepts the extended sort vocabulary (e.g. -salePrice)', async () => {
    const { user } = renderHarness();
    // Default matches the Trendyol seller-panel ordering — newest listings first.
    expect(screen.getByTestId('sort').textContent).toBe('-platformCreatedAt');

    await user.click(screen.getByText('sort-desc-price'));
    expect(screen.getByTestId('sort').textContent).toBe('-salePrice');
  });

  it('drops a retired status chip from an old link but keeps a current one', () => {
    renderHarness({
      filters: JSON.stringify([
        { id: 'old', field: 'status', operator: 'eq', value: 'onSale' },
        { id: 'new', field: 'status', operator: 'eq', value: ProductVariantStatus.NOT_ON_SALE },
      ]),
    });
    expect(screen.getByTestId('filterValues').textContent).toBe(ProductVariantStatus.NOT_ON_SALE);
  });

  it('falls back to no override tab for a retired overrideMissing=vat link', () => {
    renderHarness({ overrideMissing: 'vat' });
    expect(screen.getByTestId('overrideMissing').textContent).toBe('null');
  });
});
