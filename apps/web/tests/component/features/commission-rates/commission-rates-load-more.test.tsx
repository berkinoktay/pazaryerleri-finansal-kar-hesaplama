import { describe, expect, it, vi } from 'vitest';

import { CommissionRatesLoadMore } from '@/features/commission-rates/components/commission-rates-load-more';

import { render, screen } from '../../../helpers/render';

describe('CommissionRatesLoadMore', () => {
  it('returns null when zero rows have loaded', () => {
    const { container } = render(
      <CommissionRatesLoadMore
        hasNextPage={false}
        isFetchingNextPage={false}
        totalLoaded={0}
        onLoadMore={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the Daha fazla yükle button when more pages remain', async () => {
    const onLoadMore = vi.fn();
    const { user } = render(
      <CommissionRatesLoadMore
        hasNextPage
        isFetchingNextPage={false}
        totalLoaded={50}
        onLoadMore={onLoadMore}
      />,
    );
    const button = screen.getByRole('button', { name: 'Daha fazla yükle' });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('disables the button while fetching the next page', () => {
    render(
      <CommissionRatesLoadMore
        hasNextPage
        isFetchingNextPage
        totalLoaded={50}
        onLoadMore={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Yükleniyor…' })).toBeDisabled();
  });

  it('renders the exhausted caption when no more pages and rows loaded', () => {
    render(
      <CommissionRatesLoadMore
        hasNextPage={false}
        isFetchingNextPage={false}
        totalLoaded={134}
        onLoadMore={() => {}}
      />,
    );
    expect(screen.getByText(/134/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
