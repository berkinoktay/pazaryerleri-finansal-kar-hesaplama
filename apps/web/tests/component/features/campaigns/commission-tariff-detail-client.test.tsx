import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

// `@/i18n/navigation` pulls in next-intl's client navigation, which resolves `next/navigation`
// (unavailable under vitest). Stub the symbol the detail client uses.
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// `CurrentScopeProvider` (mounted through `TestScope`) imports the router and two server actions.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/active-store-actions', () => ({ setActiveStoreIdAction: vi.fn() }));
vi.mock('@/lib/active-org-actions', () => ({ setActiveOrgIdAction: vi.fn() }));

import { MemberRole } from '@pazarsync/db/enums';

import type {
  CommissionTariffDetail,
  TariffBandResult,
  TariffDetailItem,
} from '@/features/campaigns/api/get-tariff-detail.api';
import { CommissionTariffDetailClient } from '@/features/campaigns/components/commission-tariff-detail-client';

import trMessages from '../../../../messages/tr.json';
import { TestScope, type TestScopeProps } from '../../../helpers/current-scope';
import { HttpResponse, http, server } from '../../../helpers/msw';
import { NuqsTestHarness } from '../../../helpers/nuqs';
import { render, screen, waitFor } from '../../../helpers/render';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const TARIFF_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const DETAIL_URL = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/commission-tariffs/${TARIFF_ID}`;

const PAGE = trMessages.commissionTariffsPage;
const TABLE = PAGE.table;
const NOTICE = trMessages.campaignAccess.readOnlyNotice;
const PRODUCT = 'Stored Band Product';

// Fixture copied from tests/unit/hooks/use-commission-tariff-detail.test.tsx, completed to the
// full item shape and with a stored band choice on the first item.
function band(overrides: Partial<TariffBandResult> = {}): TariffBandResult {
  return {
    key: 'band1',
    lowerLimit: '450.00',
    upperLimit: null,
    price: '450.00',
    commissionPct: '18.00',
    netProfit: '42.00',
    marginPct: '10.50',
    ...overrides,
  };
}

/** A priced row whose band1 is stored as the seller's choice (a plain band, no custom price). */
function detailItem(): TariffDetailItem {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    barcode: '8681234567890',
    stockCode: 'SKU-1',
    productTitle: PRODUCT,
    imageUrl: null,
    category: 'Category A',
    brand: 'Brand B',
    currentPrice: '450.00',
    commissionBasePrice: '450.00',
    currentCommissionPct: '18.00',
    currentNetProfit: '42.00',
    currentMarginPct: '10.50',
    calculable: true,
    reason: null,
    bestBandKey: 'band1',
    selectedBand: 'band1',
    customPrice: null,
    bands: [band(), band({ key: 'band2', upperLimit: '449.99', price: '400.00' })],
  };
}

/** A row whose current price could not be read: band1 (no limits) has no price either. */
function unknownPriceItem(): TariffDetailItem {
  return {
    ...detailItem(),
    id: 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee',
    productTitle: 'Unknown Price Product',
    currentPrice: null,
    commissionBasePrice: null,
    currentNetProfit: null,
    currentMarginPct: null,
    bestBandKey: 'band2',
    selectedBand: null,
    bands: [
      band({ lowerLimit: null, upperLimit: null, price: null, netProfit: null, marginPct: null }),
      band({ key: 'band2', upperLimit: '449.99', price: '449.99' }),
    ],
  };
}

function detailResponse(): CommissionTariffDetail {
  return {
    id: TARIFF_ID,
    name: 'Three day tariff',
    exported: false,
    periods: [
      {
        id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        dateRangeLabel: '30 Haz - 2 Tem',
        dayCount: 3,
        validity: 'active',
        items: [detailItem(), unknownPriceItem()],
      },
    ],
  };
}

/** The member's role; defaults to an owner on Trendyol. */
type ScopeOptions = Pick<TestScopeProps, 'role'>;

function renderClient(scope: ScopeOptions = {}): ReturnType<typeof render> {
  server.use(http.get(DETAIL_URL, () => HttpResponse.json(detailResponse())));
  return render(
    <NuqsTestHarness>
      <TestScope orgId={ORG_ID} storeId={STORE_ID} {...scope}>
        <CommissionTariffDetailClient orgId={ORG_ID} storeId={STORE_ID} tariffId={TARIFF_ID} />
      </TestScope>
    </NuqsTestHarness>,
  );
}

async function waitForLoaded(): Promise<void> {
  await waitFor(() => expect(screen.getAllByText(PRODUCT).length).toBeGreaterThan(0));
}

describe('CommissionTariffDetailClient - access', () => {
  it('shows a read-only member the notice and the stored band, with no write control', async () => {
    renderClient({ role: MemberRole.VIEWER });
    await waitForLoaded();

    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: PAGE.actions.export })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: PAGE.templates.delete })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: PAGE.smartSelect.label })).toHaveLength(0);

    // No band can be chosen: neither an unselected nor a selected band has a select target.
    expect(screen.queryAllByRole('button', { name: TABLE.selectBand })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: TABLE.bandSelected })).toHaveLength(0);
    // The stored band still reads as selected, as plain text.
    expect(screen.getAllByText(TABLE.bandSelected).length).toBeGreaterThan(0);

    // Every custom price input (desktop table + mobile cards) is disabled and invites nothing.
    const inputs = screen.getAllByLabelText(new RegExp(`^${TABLE.customPrice} — `));
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      expect(input).toBeDisabled();
      expect(input).not.toHaveAttribute('placeholder');
    }
    expect(screen.queryByText(TABLE.enterPrice)).toBeNull();
    expect(screen.queryAllByText(TABLE.customPriceHint)).toHaveLength(0);
  });

  it('offers the lowest writing role export, delete and band selection, with no notice', async () => {
    renderClient({ role: MemberRole.MEMBER });
    await waitForLoaded();

    expect(screen.getByRole('button', { name: PAGE.actions.export })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: PAGE.templates.delete })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: TABLE.selectBand }).length).toBeGreaterThan(0);
    expect(screen.queryByText(NOTICE)).toBeNull();
  });
});
