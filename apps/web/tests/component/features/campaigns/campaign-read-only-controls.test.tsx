import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { DiscountListDetail } from '@/features/campaigns/api/get-discount-list-detail.api';
import type { MarketplaceCampaignDetail } from '@/features/campaigns/api/get-marketplace-campaign-detail.api';
import { AdvantageCommissionSourceHeader } from '@/features/campaigns/components/advantage-commission-source-header';
import { DiscountConfigCard } from '@/features/campaigns/components/discount-config-card';
import { DiscountItemsToolbar } from '@/features/campaigns/components/discount-items-toolbar';
import { MarketplaceCampaignConfigCard } from '@/features/campaigns/components/marketplace-campaign-config-card';
import { adaptMarketplaceCampaignDetail } from '@/features/campaigns/lib/adapt-marketplace-campaign';
import { type CampaignAccess, UPLOAD_GATES } from '@/features/campaigns/lib/campaign-access';
import { CampaignAccessProvider } from '@/features/campaigns/lib/campaign-access-context';
import type { DiscountFilterState } from '@/features/campaigns/lib/discount-selection';

import trMessages from '../../../../messages/tr.json';
import { HttpResponse, http, server } from '../../../helpers/msw';
import { render, screen, waitFor } from '../../../helpers/render';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const TARIFF_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const COMMISSION_TARIFFS_URL = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/commission-tariffs`;

const DISCOUNTS = trMessages.discountsPage;
const CAMPAIGNS = trMessages.marketplaceCampaignsPage;
const COMMISSION_SOURCE = trMessages.productLabelsPage.commissionSource;

const READ_ONLY: CampaignAccess = { canWrite: false, upload: UPLOAD_GATES.HIDDEN };

/** Wraps a control in the read-only access; without it the context default is full access. */
function readOnly(ui: React.ReactElement): React.ReactElement {
  return <CampaignAccessProvider value={READ_ONLY}>{ui}</CampaignAccessProvider>;
}

const NO_DISCOUNT_FILTERS: DiscountFilterState = { query: '', profitable: false, losing: false };

function discountToolbar(): React.ReactElement {
  return (
    <DiscountItemsToolbar
      filters={NO_DISCOUNT_FILTERS}
      onFiltersChange={vi.fn()}
      onSelectAll={vi.fn()}
      onSelectProfitable={vi.fn()}
      onClearSelections={vi.fn()}
      selectionsPending={false}
      selectedCount={0}
    />
  );
}

/** The config part of `detailResponse()` in discount-detail-client.test.tsx; the card reads no item. */
const DISCOUNT_LIST: DiscountListDetail = {
  id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  name: 'July discounts',
  discountType: 'NET',
  valueKind: 'PERCENT',
  value: '20',
  minBasketAmount: null,
  minQuantity: null,
  buyQuantity: null,
  payQuantity: null,
  nthIndex: null,
  startsAt: null,
  endsAt: null,
  exported: false,
  commissionTariffName: null,
  commissionPeriodLabel: null,
  commissionTariffOutdated: false,
  scenarioPresentation: 'UNIT',
  items: [],
};

/**
 * The config part of `detailResponse()` in marketplace-campaign-detail-client.test.tsx, run
 * through the adapter the detail client uses; the card reads no item.
 */
const CAMPAIGN_DETAIL: MarketplaceCampaignDetail = {
  id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  name: 'August campaign',
  discountType: 'BUY_X_PAY_Y',
  valueKind: null,
  value: null,
  minBasketAmount: null,
  minQuantity: null,
  buyQuantity: 2,
  payQuantity: 1,
  nthIndex: null,
  trendyolFundingPct: '0.00',
  startsAt: '2026-08-01T07:00:00.000Z',
  endsAt: '2026-08-07T20:59:00.000Z',
  exported: false,
  commissionTariffName: null,
  commissionPeriodLabel: null,
  commissionTariffOutdated: false,
  scenarioPresentation: 'ORDER',
  items: [],
};
const CAMPAIGN_HEADER = adaptMarketplaceCampaignDetail(CAMPAIGN_DETAIL).header;

/**
 * Serves the commission tariff list the "change" dropdown reads (it is fetched for every member)
 * and reports when it was asked for, so the request settles inside the test.
 */
function serveEmptyCommissionTariffs(): () => boolean {
  let requested = false;
  server.use(
    http.get(COMMISSION_TARIFFS_URL, () => {
      requested = true;
      return HttpResponse.json({ data: [] });
    }),
  );
  return () => requested;
}

function commissionSourceHeader(): React.ReactElement {
  return (
    <AdvantageCommissionSourceHeader
      orgId={ORG_ID}
      storeId={STORE_ID}
      tariffId={TARIFF_ID}
      commissionSource={null}
      commissionSourceMode="category"
    />
  );
}

describe('campaign detail controls for a member who cannot write', () => {
  describe('DiscountItemsToolbar', () => {
    it('keeps search, filters and the variant note but drops the smart select', () => {
      render(readOnly(discountToolbar()));

      expect(screen.queryByRole('button', { name: DISCOUNTS.smartSelect.label })).toBeNull();
      expect(screen.getByPlaceholderText(DISCOUNTS.search)).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: DISCOUNTS.filters.profitable }),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: DISCOUNTS.filters.losing })).toBeInTheDocument();
      expect(screen.getByText(DISCOUNTS.table.variantNote)).toBeInTheDocument();
    });

    it('offers the smart select with no provider (full access)', () => {
      render(discountToolbar());

      expect(screen.getByRole('button', { name: DISCOUNTS.smartSelect.label })).toBeInTheDocument();
    });
  });

  describe('DiscountConfigCard', () => {
    it('shows the config without the edit button', () => {
      render(readOnly(<DiscountConfigCard list={DISCOUNT_LIST} onEdit={vi.fn()} />));

      expect(screen.queryByRole('button', { name: DISCOUNTS.configCard.edit })).toBeNull();
      expect(screen.getByText(DISCOUNTS.configCard.assumption)).toBeInTheDocument();
    });

    it('offers the edit button with no provider (full access)', () => {
      render(<DiscountConfigCard list={DISCOUNT_LIST} onEdit={vi.fn()} />);

      expect(screen.getByRole('button', { name: DISCOUNTS.configCard.edit })).toBeInTheDocument();
    });
  });

  describe('MarketplaceCampaignConfigCard', () => {
    it('shows the config without the edit button', () => {
      render(readOnly(<MarketplaceCampaignConfigCard header={CAMPAIGN_HEADER} onEdit={vi.fn()} />));

      expect(screen.queryByRole('button', { name: CAMPAIGNS.configCard.edit })).toBeNull();
      expect(screen.getByText(CAMPAIGNS.configCard.assumption)).toBeInTheDocument();
    });

    it('offers the edit button with no provider (full access)', () => {
      render(<MarketplaceCampaignConfigCard header={CAMPAIGN_HEADER} onEdit={vi.fn()} />);

      expect(screen.getByRole('button', { name: CAMPAIGNS.configCard.edit })).toBeInTheDocument();
    });
  });

  describe('AdvantageCommissionSourceHeader', () => {
    it('shows the source and its hint without the change button', async () => {
      const wasRequested = serveEmptyCommissionTariffs();
      render(readOnly(commissionSourceHeader()));

      await waitFor(() => expect(wasRequested()).toBe(true));
      expect(screen.queryByRole('button', { name: COMMISSION_SOURCE.change })).toBeNull();
      expect(screen.getByText(COMMISSION_SOURCE.category)).toBeInTheDocument();
      expect(screen.getByText(COMMISSION_SOURCE.categoryHint)).toBeInTheDocument();
    });

    it('offers the change button with no provider (full access)', async () => {
      const wasRequested = serveEmptyCommissionTariffs();
      render(commissionSourceHeader());

      await waitFor(() => expect(wasRequested()).toBe(true));
      expect(screen.getByRole('button', { name: COMMISSION_SOURCE.change })).toBeInTheDocument();
    });
  });
});
