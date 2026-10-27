import { describe, expect, it, vi } from 'vitest';

import { MarketplaceCampaignToolbar } from '@/features/campaigns/components/marketplace-campaign-toolbar';
import type { CampaignFilterState } from '@/features/campaigns/lib/marketplace-campaign-selection';

import trMessages from '../../../../messages/tr.json';
import { render, screen, waitFor } from '../../../helpers/render';

const PAGE = trMessages.marketplaceCampaignsPage;

const NO_FILTERS: CampaignFilterState = {
  query: '',
  profitable: false,
  losing: false,
  selected: false,
  tariffWarning: false,
};

function renderToolbar(
  overrides: Partial<React.ComponentProps<typeof MarketplaceCampaignToolbar>> = {},
) {
  const props = {
    filters: NO_FILTERS,
    onFiltersChange: vi.fn(),
    showTariffWarningFilter: false,
    onSelectAllMax: vi.fn(),
    onSelectProfitable: vi.fn(),
    onOpenTargetMargin: vi.fn(),
    onClearSelections: vi.fn(),
    pending: false,
    ...overrides,
  };
  return { ...render(<MarketplaceCampaignToolbar {...props} />), props };
}

describe('MarketplaceCampaignToolbar', () => {
  it('offers the tariff chip only when some row carries the warning', () => {
    const { unmount } = renderToolbar();
    expect(screen.queryByRole('button', { name: PAGE.filters.tariffWarning })).toBeNull();
    unmount();

    renderToolbar({ showTariffWarningFilter: true });
    expect(screen.getByRole('button', { name: PAGE.filters.tariffWarning })).toBeInTheDocument();
  });

  it('reports a chip toggle and a search keystroke as partial filter changes', async () => {
    const { user, props } = renderToolbar({ filters: { ...NO_FILTERS, profitable: true } });

    const profitable = screen.getByRole('button', { name: PAGE.filters.profitable });
    expect(profitable).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: PAGE.filters.losing }));
    expect(props.onFiltersChange).toHaveBeenLastCalledWith({ losing: true });

    await user.type(screen.getByPlaceholderText(PAGE.search), 'k');
    expect(props.onFiltersChange).toHaveBeenLastCalledWith({ query: 'k' });
  });

  it('runs a smart-select action and closes its menu, so a dialog never opens over it', async () => {
    const { user, props } = renderToolbar();

    await user.click(screen.getByRole('button', { name: PAGE.smartSelect.label }));
    // "Tümünü…" acts on the visible rows only, and the menu says so.
    expect(await screen.findByText(PAGE.smartSelect.scopeHint)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: PAGE.smartSelect.targetMargin }));

    expect(props.onOpenTargetMargin).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: PAGE.smartSelect.targetMargin })).toBeNull(),
    );
    expect(props.onSelectAllMax).not.toHaveBeenCalled();
  });
});
