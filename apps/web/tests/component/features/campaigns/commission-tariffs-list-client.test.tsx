import { type JsonBodyType } from 'msw';
import { createTranslator } from 'next-intl';
import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { push, toastError, toastSuccess, toastWarning } = vi.hoisted(() => ({
  push: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
}));

// `@/i18n/navigation` pulls in next-intl's client navigation, which resolves `next/navigation`
// (unavailable under vitest). The list client opens the new tariff with `push`.
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/campaigns/product-commission-tariffs',
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// The global error pipeline and both upload warnings toast through sonner.
vi.mock('sonner', () => ({
  toast: { error: toastError, success: toastSuccess, warning: toastWarning },
}));

// `CurrentScopeProvider` (mounted through `TestScope`) imports the router and two server actions.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/active-store-actions', () => ({ setActiveStoreIdAction: vi.fn() }));
vi.mock('@/lib/active-org-actions', () => ({ setActiveOrgIdAction: vi.fn() }));

import { MemberRole, Platform } from '@pazarsync/db/enums';

import type { CommissionTariffListItem } from '@/features/campaigns/api/list-tariffs.api';
import { CommissionTariffsListClient } from '@/features/campaigns/components/commission-tariffs-list-client';
import { QueryProvider } from '@/providers/query-provider';

import trMessages from '../../../../messages/tr.json';
import { TestScope, type TestScopeProps } from '../../../helpers/current-scope';
import { HttpResponse, http, server } from '../../../helpers/msw';
import { NuqsTestHarness } from '../../../helpers/nuqs';
import { render, screen, waitFor, within } from '../../../helpers/render';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const TARIFF_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const NEW_TARIFF_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const BASE = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/commission-tariffs`;
const IMPORT_URL = `${BASE}/import`;
const DETAIL_PATH = `/campaigns/product-commission-tariffs/${NEW_TARIFF_ID}`;

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const UNKNOWN_PRICE_ROWS = 3;
const UNKNOWN_COMMISSION_ROWS = 2;

const LIST = trMessages.commissionTariffsPage.list;
const UPLOAD = trMessages.commissionTariffsPage.upload;
const NOTICE = trMessages.campaignAccess.readOnlyNotice;
const UNSUPPORTED = trMessages.campaignUpload.errors.unsupportedPlatform;

// Expected texts are built from the catalog, never typed.
const tUpload = createTranslator({
  locale: 'tr',
  messages: trMessages,
  namespace: 'campaignUpload',
});

/** One saved tariff, so the page renders its toolbar (one upload button) instead of the empty state. */
function savedTariff(): CommissionTariffListItem {
  return {
    id: TARIFF_ID,
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

/**
 * The import answer with no prefilled row, so the prefilled warning (also a
 * `toast.warning`) stays quiet and any warning is the unknown price or commission one.
 * Without `unknownCommissionRows` the body is the one an API one deploy behind sends.
 */
function importBody(unknownCurrentPriceRows: number, unknownCommissionRows?: number): JsonBodyType {
  return {
    tariffId: NEW_TARIFF_ID,
    productCount: 12,
    periodCount: 1,
    itemCount: 12,
    matched: 12,
    unmatched: 0,
    skippedRows: 0,
    prefilledRows: 0,
    unknownCurrentPriceRows,
    ...(unknownCommissionRows === undefined ? {} : { unknownCommissionRows }),
  };
}

/** Serves the list read and an import answering 201 with `body`. */
function serve(body: JsonBodyType): void {
  server.use(
    http.get(BASE, () => HttpResponse.json({ data: [savedTariff()] })),
    http.post(IMPORT_URL, () => HttpResponse.json(body, { status: 201 })),
  );
}

/** The member's role and the store's platform; defaults to an owner on Trendyol. */
type ScopeOptions = Pick<TestScopeProps, 'role' | 'platform'>;

function renderClient(scope: ScopeOptions = {}): ReturnType<typeof render> {
  // The real global error pipeline, so "no error toast" is a real check.
  return render(
    <NuqsTestHarness>
      <QueryProvider>
        <TestScope orgId={ORG_ID} storeId={STORE_ID} {...scope}>
          <CommissionTariffsListClient orgId={ORG_ID} storeId={STORE_ID} />
        </TestScope>
      </QueryProvider>
    </NuqsTestHarness>,
  );
}

/** Serves the list read only: the access cases never upload. */
function serveList(): void {
  server.use(http.get(BASE, () => HttpResponse.json({ data: [savedTariff()] })));
}

/** Waits until the saved tariff is listed in the table, so absence checks run on a loaded page. */
async function waitForSavedRow(): Promise<void> {
  await waitFor(() =>
    expect(within(screen.getByRole('table')).getByText(savedTariff().name)).toBeInTheDocument(),
  );
}

/** Opens the upload dialog, picks a file, and submits it. */
async function submitUpload(user: ReturnType<typeof render>['user']): Promise<void> {
  await user.click(await screen.findByRole('button', { name: LIST.upload }));
  const dialog = await screen.findByRole('dialog');

  const input = dialog.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('file input not found');
  await user.upload(input, new File(['pk'], 'tariff.xlsx', { type: XLSX_TYPE }));

  await user.click(within(dialog).getByRole('button', { name: UPLOAD.submit }));
}

beforeEach(() => {
  push.mockClear();
  toastError.mockClear();
  toastSuccess.mockClear();
  toastWarning.mockClear();
});

describe('<CommissionTariffsListClient> import', () => {
  it('warns once with the count of rows with an unknown price and opens the new tariff', async () => {
    serve(importBody(UNKNOWN_PRICE_ROWS));
    const { user } = renderClient();

    await submitUpload(user);

    await waitFor(() => expect(push).toHaveBeenCalledWith(DETAIL_PATH));
    expect(toastWarning).toHaveBeenCalledTimes(1);
    expect(toastWarning).toHaveBeenCalledWith(
      tUpload('unknownCurrentPriceWarning', { count: UNKNOWN_PRICE_ROWS }),
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it('opens the new tariff without a warning when every row has a known price', async () => {
    serve(importBody(0));
    const { user } = renderClient();

    await submitUpload(user);

    await waitFor(() => expect(push).toHaveBeenCalledWith(DETAIL_PATH));
    expect(toastWarning).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('warns once after an upload with unknown commissions', async () => {
    serve(importBody(UNKNOWN_PRICE_ROWS, UNKNOWN_COMMISSION_ROWS));
    const { user } = renderClient();

    await submitUpload(user);

    await waitFor(() => expect(push).toHaveBeenCalledWith(DETAIL_PATH));
    // Both counts set: one toast carrying both sentences.
    expect(toastWarning).toHaveBeenCalledTimes(1);
    expect(toastWarning).toHaveBeenCalledWith(
      [
        tUpload('unknownCurrentPriceWarning', { count: UNKNOWN_PRICE_ROWS }),
        tUpload('unknownCommissionWarning', { count: UNKNOWN_COMMISSION_ROWS }),
      ].join(' '),
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it('does not warn when both counts are 0', async () => {
    serve(importBody(0, 0));
    const { user } = renderClient();

    await submitUpload(user);

    await waitFor(() => expect(push).toHaveBeenCalledWith(DETAIL_PATH));
    expect(toastWarning).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe('<CommissionTariffsListClient> access', () => {
  it('shows a read-only member the notice and the saved tariff, with no upload', async () => {
    serveList();
    renderClient({ role: MemberRole.VIEWER });

    await waitForSavedRow();
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: LIST.upload })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('disables the upload with the platform sentence for a writer on an unsupported store', async () => {
    serveList();
    renderClient({ role: MemberRole.OWNER, platform: Platform.HEPSIBURADA });

    await waitForSavedRow();
    expect(screen.getByRole('button', { name: LIST.upload })).toBeDisabled();
    expect(screen.getByText(UNSUPPORTED)).toBeInTheDocument();
    expect(screen.queryByText(NOTICE)).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows a read-only member on an unsupported store the notice only', async () => {
    serveList();
    renderClient({ role: MemberRole.VIEWER, platform: Platform.HEPSIBURADA });

    await waitForSavedRow();
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    expect(screen.queryByText(UNSUPPORTED)).toBeNull();
    expect(screen.queryByRole('button', { name: LIST.upload })).toBeNull();
  });

  it('offers the lowest writing role an enabled upload and no notice', async () => {
    serveList();
    renderClient({ role: MemberRole.MEMBER });

    await waitForSavedRow();
    expect(screen.getByRole('button', { name: LIST.upload })).toBeEnabled();
    expect(screen.queryByText(NOTICE)).toBeNull();
    expect(screen.queryByText(UNSUPPORTED)).toBeNull();
  });
});
