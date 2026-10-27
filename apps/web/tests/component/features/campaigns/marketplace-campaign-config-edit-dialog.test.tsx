import { describe, expect, it, vi } from 'vitest';

import { MarketplaceCampaignConfigEditDialog } from '@/features/campaigns/components/marketplace-campaign-config-edit-dialog';
import type { MarketplaceCampaignHeader } from '@/features/campaigns/lib/adapt-marketplace-campaign';

import trMessages from '../../../../messages/tr.json';
import { HttpResponse, http, server } from '../../../helpers/msw';
import { render, screen, waitFor } from '../../../helpers/render';

const UPLOAD = trMessages.marketplaceCampaignsPage.upload;
const FIELDS = trMessages.discountsPage.upload.fields;
const SAVE_LABEL = trMessages.common.save;

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const CAMPAIGN_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/marketplace-campaigns/${CAMPAIGN_ID}`;

/** A saved NET + percent campaign Trendyol funds 60 % of, with its window. */
function makeHeader(): MarketplaceCampaignHeader {
  return {
    id: CAMPAIGN_ID,
    name: 'Ağustos Kampanyası',
    discountType: 'NET',
    valueKind: 'PERCENT',
    value: '20.00',
    minBasketAmount: null,
    minQuantity: null,
    buyQuantity: null,
    payQuantity: null,
    nthIndex: null,
    trendyolFundingPct: '60.00',
    startsAt: '2026-08-01T07:00:00.000Z',
    endsAt: '2026-08-07T20:59:00.000Z',
    exported: false,
    commissionTariffName: null,
    commissionPeriodLabel: null,
    commissionTariffOutdated: false,
    scenarioPresentation: 'UNIT',
  };
}

function renderDialog() {
  const onOpenChange = vi.fn<(open: boolean) => void>();
  const result = render(
    <MarketplaceCampaignConfigEditDialog
      open
      onOpenChange={onOpenChange}
      orgId={ORG_ID}
      storeId={STORE_ID}
      campaignId={CAMPAIGN_ID}
      header={makeHeader()}
    />,
  );
  return { ...result, onOpenChange };
}

describe('<MarketplaceCampaignConfigEditDialog>', () => {
  it('seeds the saved kurgu, value and funding rate', () => {
    renderDialog();

    expect(screen.getByLabelText(FIELDS.valueKind)).toHaveTextContent(FIELDS.valueKindPercent);
    expect(screen.getByLabelText(FIELDS.value)).toHaveValue('20.00');
    expect(screen.getByLabelText(UPLOAD.fundingLabel)).toHaveValue('60.00');
    expect(screen.getByLabelText(UPLOAD.name)).toHaveValue('Ağustos Kampanyası');
  });

  it('a cleared funding rate is saved as an explicit "0" inside the FULL config, then closes', async () => {
    let received: Record<string, unknown> | null = null;
    server.use(
      http.patch(ENDPOINT, async ({ request }) => {
        const body: unknown = await request.json();
        received = typeof body === 'object' && body !== null ? { ...body } : null;
        return HttpResponse.json({ id: CAMPAIGN_ID });
      }),
    );
    const { user, onOpenChange } = renderDialog();

    // The PATCH replaces the whole config, so an emptied rate must still travel — as "0".
    await user.clear(screen.getByLabelText(UPLOAD.fundingLabel));
    await user.click(screen.getByRole('button', { name: SAVE_LABEL }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(received).toEqual({
      discountType: 'NET',
      valueKind: 'PERCENT',
      value: '20.00',
      trendyolFundingPct: '0',
      startsAt: '2026-08-01T07:00:00.000Z',
      endsAt: '2026-08-07T20:59:00.000Z',
      name: 'Ağustos Kampanyası',
    });
  });
});
