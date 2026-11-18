import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

// `@/i18n/navigation` pulls in next-intl's client navigation, which resolves `next/navigation`
// (unavailable under vitest). The list clients open a row with `push`.
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/campaigns',
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// The global error pipeline toasts through sonner.
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

// `CurrentScopeProvider` (mounted through `TestScope`) imports the router and two server actions.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/active-store-actions', () => ({ setActiveStoreIdAction: vi.fn() }));
vi.mock('@/lib/active-org-actions', () => ({ setActiveOrgIdAction: vi.fn() }));

import { MemberRole, Platform } from '@pazarsync/db/enums';

import { AdvantageTariffsListClient } from '@/features/campaigns/components/advantage-tariffs-list-client';
import { DiscountsListClient } from '@/features/campaigns/components/discount-lists-client';
import { FlashProductsListClient } from '@/features/campaigns/components/flash-products-list-client';
import { MarketplaceCampaignsListClient } from '@/features/campaigns/components/marketplace-campaigns-list-client';
import { PlusTariffsListClient } from '@/features/campaigns/components/plus-tariffs-list-client';
import { QueryProvider } from '@/providers/query-provider';

import trMessages from '../../../../messages/tr.json';
import { TestScope, type TestScopeProps } from '../../../helpers/current-scope';
import { HttpResponse, http, server } from '../../../helpers/msw';
import { NuqsTestHarness } from '../../../helpers/nuqs';
import { render, screen, waitFor } from '../../../helpers/render';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const STORE_BASE = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}`;

const NOTICE = trMessages.campaignAccess.readOnlyNotice;

interface ListClientProps {
  orgId: string | null;
  storeId: string | null;
}

/**
 * One list client and what its screen shows. The commission list has its own access test; the
 * others are covered here, so dropping the access wiring from any of them fails a test.
 */
interface ListClientCase {
  name: string;
  Client: (props: ListClientProps) => React.ReactElement;
  /**
   * The list route segments under the store the screen reads, each served an empty list: the
   * page's own list, plus any list its mounted upload dialog loads.
   */
  segments: readonly string[];
  /** The upload label (the tab-row button and the first-run empty state share it). */
  upload: string;
  /** The first-run empty state title, shown once the empty list has loaded. */
  emptyTitle: string;
}

const CASES: readonly ListClientCase[] = [
  {
    name: 'AdvantageTariffsListClient',
    Client: AdvantageTariffsListClient,
    // The Advantage upload dialog loads the commission tariffs as its commission sources.
    segments: ['advantage-tariffs', 'commission-tariffs'],
    upload: trMessages.productLabelsPage.list.upload,
    emptyTitle: trMessages.productLabelsPage.list.empty.title,
  },
  {
    name: 'MarketplaceCampaignsListClient',
    Client: MarketplaceCampaignsListClient,
    segments: ['marketplace-campaigns'],
    upload: trMessages.marketplaceCampaignsPage.list.upload,
    emptyTitle: trMessages.marketplaceCampaignsPage.list.empty.title,
  },
  {
    name: 'PlusTariffsListClient',
    Client: PlusTariffsListClient,
    segments: ['plus-commission-tariffs'],
    upload: trMessages.plusCommissionTariffsPage.list.upload,
    emptyTitle: trMessages.plusCommissionTariffsPage.list.empty.title,
  },
  {
    name: 'FlashProductsListClient',
    Client: FlashProductsListClient,
    segments: ['flash-products'],
    upload: trMessages.flashProductsPage.list.upload,
    emptyTitle: trMessages.flashProductsPage.list.empty.title,
  },
  {
    name: 'DiscountsListClient',
    Client: DiscountsListClient,
    segments: ['discount-lists'],
    upload: trMessages.discountsPage.list.upload,
    emptyTitle: trMessages.discountsPage.list.empty.title,
  },
];

function renderClient(
  { Client, segments }: ListClientCase,
  scope: Pick<TestScopeProps, 'role' | 'platform'>,
): ReturnType<typeof render> {
  server.use(
    ...segments.map((segment) =>
      http.get(`${STORE_BASE}/${segment}`, () => HttpResponse.json({ data: [] })),
    ),
  );
  return render(
    <NuqsTestHarness>
      <QueryProvider>
        <TestScope orgId={ORG_ID} storeId={STORE_ID} {...scope}>
          <Client orgId={ORG_ID} storeId={STORE_ID} />
        </TestScope>
      </QueryProvider>
    </NuqsTestHarness>,
  );
}

describe.each(CASES)('<$name> access', (listCase) => {
  it('shows a read-only member the notice and no upload button', async () => {
    renderClient(listCase, { role: MemberRole.VIEWER });

    // Wait for the empty list to load, so the absence check runs where the CTA would appear.
    expect((await screen.findAllByText(listCase.emptyTitle)).length).toBeGreaterThan(0);
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: listCase.upload })).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers an owner on Trendyol an enabled upload and no notice', async () => {
    renderClient(listCase, { role: MemberRole.OWNER, platform: Platform.TRENDYOL });

    expect((await screen.findAllByText(listCase.emptyTitle)).length).toBeGreaterThan(0);
    expect(screen.queryByText(NOTICE)).toBeNull();
    // The tab-row button and the empty state's CTA share the label: every one is enabled.
    const buttons = screen.getAllByRole('button', { name: listCase.upload });
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) expect(button).toBeEnabled();
  });
});

describe('<AdvantageTariffsListClient> upload dialog', () => {
  const ADVANTAGE = CASES[0];

  /** Serves the two lists and counts the commission tariff list requests. */
  function serveCountingCommissionList(): { count: () => number } {
    let requests = 0;
    server.use(
      http.get(`${STORE_BASE}/advantage-tariffs`, () => HttpResponse.json({ data: [] })),
      http.get(`${STORE_BASE}/commission-tariffs`, () => {
        requests += 1;
        return HttpResponse.json({ data: [] });
      }),
    );
    return { count: () => requests };
  }

  function renderAdvantage(scope: Pick<TestScopeProps, 'role' | 'platform'>): void {
    render(
      <NuqsTestHarness>
        <QueryProvider>
          <TestScope orgId={ORG_ID} storeId={STORE_ID} {...scope}>
            <AdvantageTariffsListClient orgId={ORG_ID} storeId={STORE_ID} />
          </TestScope>
        </QueryProvider>
      </NuqsTestHarness>,
    );
  }

  it('is mounted for an owner, so its commission source list is loaded', async () => {
    const commissionList = serveCountingCommissionList();
    renderAdvantage({ role: MemberRole.OWNER, platform: Platform.TRENDYOL });

    expect((await screen.findAllByText(ADVANTAGE.emptyTitle)).length).toBeGreaterThan(0);
    await waitFor(() => expect(commissionList.count()).toBeGreaterThan(0));
  });

  it('is not mounted for a read-only member, so no commission source list is requested', async () => {
    const commissionList = serveCountingCommissionList();
    renderAdvantage({ role: MemberRole.VIEWER });

    expect((await screen.findAllByText(ADVANTAGE.emptyTitle)).length).toBeGreaterThan(0);
    expect(commissionList.count()).toBe(0);
  });
});
