import { describe, expect, it, vi } from 'vitest';

import { MarketplaceCampaignTargetMarginDialog } from '@/features/campaigns/components/marketplace-campaign-target-margin-dialog';

import trMessages from '../../../../messages/tr.json';
import { HttpResponse, http, server } from '../../../helpers/msw';
import { render, screen, waitFor } from '../../../helpers/render';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const CAMPAIGN_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const TARGET_MARGIN_URL = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/marketplace-campaigns/${CAMPAIGN_ID}/target-margin`;

const COPY = trMessages.marketplaceCampaignsPage.targetMargin;

const SUGGESTIONS = [
  { itemId: 'aaaaaaaa-0000-0000-0000-000000000001', price: '185.40', reason: null },
  { itemId: 'aaaaaaaa-0000-0000-0000-000000000002', price: null, reason: 'UNREACHABLE' },
];

function renderDialog() {
  const onApply = vi.fn();
  const onOpenChange = vi.fn();
  const utils = render(
    <MarketplaceCampaignTargetMarginDialog
      open
      onOpenChange={onOpenChange}
      orgId={ORG_ID}
      storeId={STORE_ID}
      campaignId={CAMPAIGN_ID}
      onApply={onApply}
    />,
  );
  return { ...utils, onApply, onOpenChange };
}

describe('MarketplaceCampaignTargetMarginDialog', () => {
  it('asks for the target margin, hands the suggestions to the buffer and closes', async () => {
    let body: unknown = null;
    server.use(
      http.post(TARGET_MARGIN_URL, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ suggestions: SUGGESTIONS });
      }),
    );
    const { user, onApply, onOpenChange } = renderDialog();

    const submit = screen.getByRole('button', { name: COPY.submit });
    // Nothing to send until a margin is typed.
    expect(submit).toBeDisabled();

    await user.type(screen.getByRole('textbox', { name: COPY.label }), '12,5');
    await user.click(submit);

    await waitFor(() => expect(onApply).toHaveBeenCalledWith(SUGGESTIONS));
    expect(body).toEqual({ targetMarginPct: '12.50' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('refuses a margin of 100% or more — no price can ever reach it', async () => {
    let requests = 0;
    server.use(
      http.post(TARGET_MARGIN_URL, () => {
        requests += 1;
        return HttpResponse.json({ suggestions: [] });
      }),
    );
    const { user, onApply } = renderDialog();

    const input = screen.getByRole('textbox', { name: COPY.label });
    await user.type(input, '150');

    expect(screen.getByText(COPY.tooHigh)).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: COPY.submit })).toBeDisabled();
    // Enter cannot slip past it either: a disabled default button blocks implicit submission.
    await user.type(input, '{Enter}');
    expect(requests).toBe(0);
    expect(onApply).not.toHaveBeenCalled();

    // Just under the ceiling is a valid (if ambitious) target.
    await user.clear(input);
    await user.type(input, '99,99');
    expect(screen.queryByText(COPY.tooHigh)).toBeNull();
    expect(screen.getByRole('button', { name: COPY.submit })).toBeEnabled();
  });

  it('keeps the dialog open and the buffer untouched when the request fails', async () => {
    server.use(
      http.post(TARGET_MARGIN_URL, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Internal', status: 500, code: 'INTERNAL_ERROR' },
          { status: 500 },
        ),
      ),
    );
    const { user, onApply, onOpenChange } = renderDialog();

    await user.type(screen.getByRole('textbox', { name: COPY.label }), '10');
    await user.click(screen.getByRole('button', { name: COPY.submit }));

    // The button settles back from its loading state once the mutation has failed.
    await waitFor(() => expect(screen.getByRole('button', { name: COPY.submit })).toBeEnabled());
    expect(onApply).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
