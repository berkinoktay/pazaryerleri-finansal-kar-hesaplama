import { describe, expect, it, vi } from 'vitest';

import type { CommissionTariffListItem } from '@/features/campaigns/api/list-tariffs.api';
import { CommissionTariffsListView } from '@/features/campaigns/components/commission-tariffs-list-view';
import {
  type CampaignAccess,
  FULL_CAMPAIGN_ACCESS,
  UPLOAD_GATES,
} from '@/features/campaigns/lib/campaign-access';
import { CampaignAccessProvider } from '@/features/campaigns/lib/campaign-access-context';

import trMessages from '../../../../messages/tr.json';
import { NuqsTestHarness } from '../../../helpers/nuqs';
import { render, screen, within } from '../../../helpers/render';

const LIST = trMessages.commissionTariffsPage.list;
const NOTICE = trMessages.campaignAccess.readOnlyNotice;
const UNSUPPORTED = trMessages.campaignUpload.errors.unsupportedPlatform;
const ROW_MENU = trMessages.common.dataTable.rowActions.trigger;

const READ_ONLY: CampaignAccess = { canWrite: false, upload: UPLOAD_GATES.HIDDEN };
const UNSUPPORTED_PLATFORM: CampaignAccess = {
  canWrite: true,
  upload: UPLOAD_GATES.UNSUPPORTED_PLATFORM,
};

/** One saved tariff, so the table renders a row instead of the first-run empty state. */
function savedTariff(): CommissionTariffListItem {
  return {
    id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    name: 'June tariff',
    productCount: 12,
    selectedCount: 5,
    exported: false,
    validity: 'active',
    weekStartsAt: null,
    weekEndsAt: null,
    updatedAt: '2026-06-30T12:00:00.000Z',
  };
}

function renderView(
  access: CampaignAccess,
  items: readonly CommissionTariffListItem[],
): ReturnType<typeof render> {
  return render(
    <NuqsTestHarness>
      <CampaignAccessProvider value={access}>
        <CommissionTariffsListView
          items={items}
          onOpen={vi.fn()}
          onCreate={vi.fn()}
          onExport={vi.fn()}
          onDelete={vi.fn()}
        />
      </CampaignAccessProvider>
    </NuqsTestHarness>,
  );
}

/** Opens the row's kebab menu and returns queries scoped to it. */
async function openRowMenu(
  user: ReturnType<typeof render>['user'],
): Promise<ReturnType<typeof within>> {
  await user.click(screen.getByRole('button', { name: ROW_MENU }));
  return within(await screen.findByRole('menu'));
}

describe('CommissionTariffsListView access', () => {
  describe('read-only member', () => {
    it('shows the notice and no write control on a listed tariff', async () => {
      const { user } = renderView(READ_ONLY, [savedTariff()]);

      expect(screen.getByText(NOTICE)).toBeInTheDocument();
      expect(within(screen.getByRole('table')).getByText(savedTariff().name)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: LIST.upload })).toBeNull();
      expect(screen.queryByRole('checkbox')).toBeNull();

      const menu = await openRowMenu(user);
      expect(menu.getByRole('menuitem', { name: LIST.actions.open })).toBeInTheDocument();
      expect(menu.queryByRole('menuitem', { name: LIST.actions.export })).toBeNull();
      expect(menu.queryByRole('menuitem', { name: LIST.actions.delete })).toBeNull();
    });

    it('shows the empty state without its upload button when there is no tariff', () => {
      renderView(READ_ONLY, []);

      expect(screen.getByText(LIST.empty.title)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: LIST.empty.cta })).toBeNull();
      expect(screen.queryByRole('button', { name: LIST.upload })).toBeNull();
    });
  });

  describe('store whose platform has no workbook format', () => {
    it('disables the upload button and explains why once, keeping export and delete', async () => {
      const { user } = renderView(UNSUPPORTED_PLATFORM, [savedTariff()]);

      expect(screen.getByRole('button', { name: LIST.upload })).toBeDisabled();
      expect(screen.getAllByText(UNSUPPORTED)).toHaveLength(1);
      expect(screen.queryByText(NOTICE)).toBeNull();

      const menu = await openRowMenu(user);
      expect(menu.getByRole('menuitem', { name: LIST.actions.export })).toBeInTheDocument();
      expect(menu.getByRole('menuitem', { name: LIST.actions.delete })).toBeInTheDocument();
    });

    it('disables the empty-state upload button too and still explains why once', () => {
      renderView(UNSUPPORTED_PLATFORM, []);

      expect(screen.getByText(LIST.empty.title)).toBeInTheDocument();
      // The tab-row label and the empty-state label may be the same text, so check every match.
      const uploadButtons = [
        ...screen.getAllByRole('button', { name: LIST.upload }),
        ...screen.getAllByRole('button', { name: LIST.empty.cta }),
      ];
      expect(new Set(uploadButtons).size).toBe(2);
      for (const button of uploadButtons) expect(button).toBeDisabled();
      expect(screen.getAllByText(UNSUPPORTED)).toHaveLength(1);
    });
  });

  describe('full access', () => {
    it('offers an enabled upload button and row checkboxes without a notice', () => {
      renderView(FULL_CAMPAIGN_ACCESS, [savedTariff()]);

      expect(screen.getByRole('button', { name: LIST.upload })).toBeEnabled();
      expect(screen.queryByText(NOTICE)).toBeNull();
      expect(screen.getByRole('checkbox', { name: LIST.selectRow })).toBeInTheDocument();
      expect(screen.queryByText(UNSUPPORTED)).toBeNull();
    });
  });
});
