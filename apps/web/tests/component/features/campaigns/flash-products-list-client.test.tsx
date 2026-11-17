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
// (unavailable under vitest). The list client opens the new upload with `push`.
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/campaigns/flash-products',
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// The global error pipeline and both upload warnings toast through sonner.
vi.mock('sonner', () => ({
  toast: { error: toastError, success: toastSuccess, warning: toastWarning },
}));

import type { FlashProductListItem } from '@/features/campaigns/api/list-flash-products.api';
import { FlashProductsListClient } from '@/features/campaigns/components/flash-products-list-client';
import { QueryProvider } from '@/providers/query-provider';

import trMessages from '../../../../messages/tr.json';
import { HttpResponse, http, server } from '../../../helpers/msw';
import { NuqsTestHarness } from '../../../helpers/nuqs';
import { render, screen, waitFor, within } from '../../../helpers/render';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const LIST_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const NEW_LIST_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const BASE = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/flash-products`;
const IMPORT_URL = `${BASE}/import`;
const DETAIL_PATH = `/campaigns/flash-products/${NEW_LIST_ID}`;

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const UNKNOWN_COMMISSION_ROWS = 2;

const LIST = trMessages.flashProductsPage.list;
const UPLOAD = trMessages.flashProductsPage.upload;

// Expected texts are built from the catalog, never typed.
const tUpload = createTranslator({
  locale: 'tr',
  messages: trMessages,
  namespace: 'campaignUpload',
});

/** One saved upload, so the page renders its toolbar (one upload button) instead of the empty state. */
function savedList(): FlashProductListItem {
  return {
    id: LIST_ID,
    name: 'June flash list',
    productCount: 12,
    itemCount: 20,
    selectedCount: 5,
    exported: false,
    updatedAt: '2026-06-30T12:00:00.000Z',
  };
}

/**
 * The import answer with no prefilled row, so the prefilled warning (also a
 * `toast.warning`) stays quiet and any warning is the unknown commission one.
 */
function importBody(unknownCommissionRows: number): JsonBodyType {
  return {
    listId: NEW_LIST_ID,
    name: 'July flash list',
    productCount: 12,
    itemCount: 20,
    matched: 12,
    unmatched: 0,
    skippedRows: 0,
    prefilledRows: 0,
    unknownCommissionRows,
  };
}

/** Serves the list read and an import answering 201 with `body`. */
function serve(body: JsonBodyType): void {
  server.use(
    http.get(BASE, () => HttpResponse.json({ data: [savedList()] })),
    http.post(IMPORT_URL, () => HttpResponse.json(body, { status: 201 })),
  );
}

function renderClient(): ReturnType<typeof render> {
  // The real global error pipeline, so "no error toast" is a real check.
  return render(
    <NuqsTestHarness>
      <QueryProvider>
        <FlashProductsListClient orgId={ORG_ID} storeId={STORE_ID} />
      </QueryProvider>
    </NuqsTestHarness>,
  );
}

/** Opens the upload dialog, picks a file, and submits it. */
async function submitUpload(user: ReturnType<typeof render>['user']): Promise<void> {
  await user.click(await screen.findByRole('button', { name: LIST.upload }));
  const dialog = await screen.findByRole('dialog');

  const input = dialog.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('file input not found');
  await user.upload(input, new File(['pk'], 'flash-products.xlsx', { type: XLSX_TYPE }));

  await user.click(within(dialog).getByRole('button', { name: UPLOAD.submit }));
}

beforeEach(() => {
  push.mockClear();
  toastError.mockClear();
  toastSuccess.mockClear();
  toastWarning.mockClear();
});

describe('<FlashProductsListClient> import', () => {
  it('warns once after an upload with unknown commissions', async () => {
    serve(importBody(UNKNOWN_COMMISSION_ROWS));
    const { user } = renderClient();

    await submitUpload(user);

    await waitFor(() => expect(push).toHaveBeenCalledWith(DETAIL_PATH));
    expect(toastWarning).toHaveBeenCalledTimes(1);
    expect(toastWarning).toHaveBeenCalledWith(
      tUpload('flashUnknownCommissionWarning', { count: UNKNOWN_COMMISSION_ROWS }),
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it('does not warn when the count is 0', async () => {
    serve(importBody(0));
    const { user } = renderClient();

    await submitUpload(user);

    await waitFor(() => expect(push).toHaveBeenCalledWith(DETAIL_PATH));
    expect(toastWarning).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });
});
