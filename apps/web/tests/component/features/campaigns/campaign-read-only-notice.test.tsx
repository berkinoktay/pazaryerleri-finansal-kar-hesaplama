import { describe, expect, it } from 'vitest';

import { CampaignReadOnlyNotice } from '@/features/campaigns/components/campaign-read-only-notice';
import {
  type CampaignAccess,
  FULL_CAMPAIGN_ACCESS,
  UPLOAD_GATES,
} from '@/features/campaigns/lib/campaign-access';
import { CampaignAccessProvider } from '@/features/campaigns/lib/campaign-access-context';

import trMessages from '../../../../messages/tr.json';
import { render, screen } from '../../../helpers/render';

const NOTICE = trMessages.campaignAccess.readOnlyNotice;

const READ_ONLY: CampaignAccess = { canWrite: false, upload: UPLOAD_GATES.HIDDEN };

describe('CampaignReadOnlyNotice', () => {
  it('renders nothing for a member with full access', () => {
    render(
      <CampaignAccessProvider value={FULL_CAMPAIGN_ACCESS}>
        <CampaignReadOnlyNotice />
      </CampaignAccessProvider>,
    );

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it('renders nothing without a provider (default is full access)', () => {
    render(<CampaignReadOnlyNotice />);

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it('shows the read-only notice for a member who cannot write', () => {
    render(
      <CampaignAccessProvider value={READ_ONLY}>
        <CampaignReadOnlyNotice />
      </CampaignAccessProvider>,
    );

    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent(NOTICE);
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
  });
});
