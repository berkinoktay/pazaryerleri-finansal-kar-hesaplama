import { describe, expect, it, type Mock, vi } from 'vitest';

import { CampaignUploadButton } from '@/features/campaigns/components/campaign-upload-button';
import {
  type CampaignAccess,
  FULL_CAMPAIGN_ACCESS,
  UPLOAD_GATES,
} from '@/features/campaigns/lib/campaign-access';
import { CampaignAccessProvider } from '@/features/campaigns/lib/campaign-access-context';

import trMessages from '../../../../messages/tr.json';
import { render, screen } from '../../../helpers/render';

// The label is a prop; any catalog leaf works as a realistic value.
const LABEL = trMessages.commissionTariffsPage.list.upload;
const UNSUPPORTED = trMessages.campaignUpload.errors.unsupportedPlatform;

const READ_ONLY: CampaignAccess = { canWrite: false, upload: UPLOAD_GATES.HIDDEN };
const UNSUPPORTED_PLATFORM: CampaignAccess = {
  canWrite: true,
  upload: UPLOAD_GATES.UNSUPPORTED_PLATFORM,
};

type Layout = 'inline' | 'stacked';

const LAYOUTS: readonly Layout[] = ['inline', 'stacked'];

function renderButton(
  access: CampaignAccess,
  props: { withNote?: boolean; layout?: Layout } = {},
): { onClick: Mock<() => void>; user: ReturnType<typeof render>['user'] } {
  const onClick = vi.fn<() => void>();
  const { user } = render(
    <CampaignAccessProvider value={access}>
      <CampaignUploadButton label={LABEL} onClick={onClick} {...props} />
    </CampaignAccessProvider>,
  );
  return { onClick, user };
}

describe('CampaignUploadButton', () => {
  it('renders an enabled upload button that calls onClick', async () => {
    const { onClick, user } = renderButton(FULL_CAMPAIGN_ACCESS);

    const button = screen.getByRole('button', { name: LABEL });
    expect(button).toBeEnabled();
    expect(screen.queryByText(UNSUPPORTED)).toBeNull();

    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when the upload is hidden', () => {
    renderButton(READ_ONLY);

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(UNSUPPORTED)).toBeNull();
  });

  it.each(LAYOUTS)(
    'disables the button and explains why on an unsupported platform (%s)',
    async (layout) => {
      const { onClick, user } = renderButton(UNSUPPORTED_PLATFORM, { layout });

      const button = screen.getByRole('button', { name: LABEL });
      expect(button).toBeDisabled();
      expect(screen.getByText(UNSUPPORTED)).toBeInTheDocument();
      expect(button).toHaveAccessibleDescription(UNSUPPORTED);

      await user.click(button);
      expect(onClick).not.toHaveBeenCalled();
    },
  );

  it('renders the disabled button alone when the note is turned off', () => {
    renderButton(UNSUPPORTED_PLATFORM, { withNote: false });

    const button = screen.getByRole('button', { name: LABEL });
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText(UNSUPPORTED)).toBeNull();
  });
});
