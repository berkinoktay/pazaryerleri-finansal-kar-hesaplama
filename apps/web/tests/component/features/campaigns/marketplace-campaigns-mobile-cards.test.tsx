import { describe, expect, it, vi } from 'vitest';

import { type RowAction } from '@/components/patterns/data-table-row-actions';
import { MarketplaceCampaignsMobileCards } from '@/features/campaigns/components/marketplace-campaigns-mobile-cards';
import { type CampaignAccess, UPLOAD_GATES } from '@/features/campaigns/lib/campaign-access';
import { CampaignAccessProvider } from '@/features/campaigns/lib/campaign-access-context';
import type { MarketplaceCampaignListRow } from '@/features/campaigns/lib/marketplace-campaign-list';

import trMessages from '../../../../messages/tr.json';
import { render, screen, within } from '../../../helpers/render';

const noResults = trMessages.common.dataTable.noResults;
const emptyTitle = trMessages.marketplaceCampaignsPage.list.empty.title;
const emptyCta = trMessages.marketplaceCampaignsPage.list.empty.cta;
const unsupportedPlatform = trMessages.campaignUpload.errors.unsupportedPlatform;

const READ_ONLY: CampaignAccess = { canWrite: false, upload: UPLOAD_GATES.HIDDEN };
const UNSUPPORTED_PLATFORM: CampaignAccess = {
  canWrite: true,
  upload: UPLOAD_GATES.UNSUPPORTED_PLATFORM,
};

function makeRow(overrides: Partial<MarketplaceCampaignListRow> = {}): MarketplaceCampaignListRow {
  return {
    id: 'c-1',
    name: 'Ağustos Sepet Kampanyası',
    discountType: 'CONDITIONAL_BASKET',
    valueKind: 'AMOUNT',
    value: '100',
    minBasketAmount: '1000',
    minQuantity: null,
    buyQuantity: null,
    payQuantity: null,
    nthIndex: null,
    trendyolFundingPct: '60',
    startsAt: '2026-08-01T07:00:00.000Z',
    endsAt: '2026-08-07T20:59:59.000Z',
    itemCount: 68,
    selectedCount: 12,
    exported: false,
    updatedAt: '2026-08-02T10:00:00.000Z',
    ...overrides,
  };
}

function renderCards(
  props: Partial<React.ComponentProps<typeof MarketplaceCampaignsMobileCards>> = {},
) {
  const onOpen = vi.fn();
  const onUpload = vi.fn();
  const onDelete = vi.fn();
  const onClearFilters = vi.fn();
  const actions: RowAction<MarketplaceCampaignListRow>[] = [
    { label: 'Sil', tone: 'destructive', onSelect: onDelete },
  ];
  const result = render(
    <MarketplaceCampaignsMobileCards
      rows={[makeRow()]}
      actions={actions}
      onOpen={onOpen}
      onUpload={onUpload}
      hasActiveFilters={false}
      onClearFilters={onClearFilters}
      {...props}
    />,
  );
  return { ...result, onOpen, onUpload, onDelete, onClearFilters };
}

/** The first-run empty state (no rows, no filter) under the given campaign access. */
function renderEmptyWithAccess(access: CampaignAccess): ReturnType<typeof render> {
  return render(
    <CampaignAccessProvider value={access}>
      <MarketplaceCampaignsMobileCards
        rows={[]}
        actions={[]}
        onOpen={vi.fn()}
        onUpload={vi.fn()}
        hasActiveFilters={false}
        onClearFilters={vi.fn()}
      />
    </CampaignAccessProvider>,
  );
}

describe('MarketplaceCampaignsMobileCards', () => {
  it('opens the campaign from its card', async () => {
    const { user, onOpen } = renderCards();
    await user.click(screen.getByRole('button', { name: 'Ağustos Sepet Kampanyası' }));
    expect(onOpen).toHaveBeenCalledWith('c-1');
  });

  // The whole card opens the campaign, so a kebab pick must stay its own target — this pins the
  // stretched-button structure against a regression to a card-level click handler.
  it('runs a kebab action without also opening the campaign', async () => {
    const { user, onOpen, onDelete } = renderCards();
    await user.click(screen.getByRole('button', { name: 'Satır işlemleri' }));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByText('Sil'));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'c-1' }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('offers to clear the filters when a search or tab hides every campaign', async () => {
    const { user, onClearFilters } = renderCards({ rows: [], hasActiveFilters: true });
    expect(screen.getByText(noResults.title)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: noResults.clearFilters }));
    expect(onClearFilters).toHaveBeenCalled();
  });

  it('offers the upload from the first-run empty state when there are no campaigns at all', async () => {
    const { user, onUpload } = renderCards({ rows: [] });
    expect(screen.getByText(emptyTitle)).toBeInTheDocument();
    expect(screen.queryByText(noResults.title)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: emptyCta }));
    expect(onUpload).toHaveBeenCalled();
  });

  it('shows a busy placeholder instead of an empty state while loading', () => {
    renderCards({ rows: [], loading: true });
    expect(screen.getByRole('status', { name: trMessages.common.loading })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.queryByText(emptyTitle)).not.toBeInTheDocument();
  });

  it('shows the first-run empty state without the upload for a member who cannot write', () => {
    renderEmptyWithAccess(READ_ONLY);
    expect(screen.getByText(emptyTitle)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: emptyCta })).not.toBeInTheDocument();
  });

  // The platform sentence stands once, next to the tab-row button, so this one is only disabled.
  it('disables the first-run upload on a platform with no workbook format', () => {
    renderEmptyWithAccess(UNSUPPORTED_PLATFORM);
    expect(screen.getByRole('button', { name: emptyCta })).toBeDisabled();
    expect(screen.queryByText(unsupportedPlatform)).not.toBeInTheDocument();
  });
});
