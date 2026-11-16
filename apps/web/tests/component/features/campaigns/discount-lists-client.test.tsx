import { type JsonBodyType } from 'msw';
import { createTranslator } from 'next-intl';
import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UPLOAD_NAME_MAX_LENGTH } from '@pazarsync/utils';

const { push, toastError, toastSuccess, toastWarning } = vi.hoisted(() => ({
  push: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
}));

// `@/i18n/navigation` pulls in next-intl's client navigation, which resolves `next/navigation`
// (unavailable under vitest). The list client navigates to the new list with `push`.
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/campaigns/discounts',
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// The global error pipeline and the prefilled warning both toast through sonner.
vi.mock('sonner', () => ({
  toast: { error: toastError, success: toastSuccess, warning: toastWarning },
}));

import type { DiscountListListItem } from '@/features/campaigns/api/list-discount-lists.api';
import { DiscountsListClient } from '@/features/campaigns/components/discount-lists-client';
import { QueryProvider } from '@/providers/query-provider';

import trMessages from '../../../../messages/tr.json';
import { validationApiError } from '../../../helpers/api-error';
import { HttpResponse, http, server } from '../../../helpers/msw';
import { NuqsTestHarness } from '../../../helpers/nuqs';
import { render, screen, waitFor, within } from '../../../helpers/render';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const LIST_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const NEW_LIST_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const BASE = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/discount-lists`;
const IMPORT_URL = `${BASE}/import`;
const DETAIL_PATH = `/campaigns/discounts/${NEW_LIST_ID}`;

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PREFILLED_ROWS = 3;
// Mid-month days: neither is ever an outside day of the calendar, and the start is the earlier.
const START_DAY = '10';
const END_DAY = '20';

const LIST = trMessages.discountsPage.list;
const UPLOAD = trMessages.discountsPage.upload;
const FIELDS = UPLOAD.fields;
const DATE_DONE = trMessages.common.dateInput.done;

// Expected texts are built from the catalog, never typed.
const tUpload = createTranslator({
  locale: 'tr',
  messages: trMessages,
  namespace: 'campaignUpload',
});

/** One saved list, so the page renders its toolbar (one upload button) instead of the empty state. */
function savedList(): DiscountListListItem {
  return {
    id: LIST_ID,
    name: 'July list',
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
    itemCount: 4,
    selectedCount: 1,
    exported: false,
    updatedAt: '2026-07-01T09:00:00.000Z',
  };
}

/** The import answer of an API that does not send `prefilledRows` yet. */
const IMPORT_BODY_WITHOUT_PREFILLED = {
  listId: NEW_LIST_ID,
  name: 'Upload',
  itemCount: 4,
  matched: 1,
  unmatched: 3,
  skippedRows: 0,
};

/** Serves the list read and the import, the import answering `body` with `status`. */
function serve(body: JsonBodyType, status: number): void {
  server.use(
    http.get(BASE, () => HttpResponse.json({ data: [savedList()] })),
    http.post(IMPORT_URL, () => HttpResponse.json(body, { status })),
  );
}

function renderClient(): ReturnType<typeof render> {
  // The real global error pipeline, so "no error toast" is a real check.
  return render(
    <NuqsTestHarness>
      <QueryProvider>
        <DiscountsListClient orgId={ORG_ID} storeId={STORE_ID} />
      </QueryProvider>
    </NuqsTestHarness>,
  );
}

/** Picks a day in the date input showing `placeholder`, then closes its popover. */
async function pickDay(
  user: ReturnType<typeof render>['user'],
  placeholder: string,
  day: string,
): Promise<void> {
  await user.click(screen.getByRole('button', { name: placeholder }));
  const grid = await screen.findByRole('grid');
  const dayButton = within(grid)
    .getAllByRole('button')
    .find((button) => button.textContent === day);
  if (dayButton === undefined) throw new Error(`day ${day} not found`);
  await user.click(dayButton);
  await user.click(screen.getByRole('button', { name: DATE_DONE }));
}

/** Opens the upload dialog, fills a valid NET config with a file, and submits it. */
async function submitUpload(user: ReturnType<typeof render>['user']): Promise<HTMLElement> {
  await user.click(await screen.findByRole('button', { name: LIST.upload }));
  const dialog = await screen.findByRole('dialog');

  const input = dialog.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('file input not found');
  await user.upload(input, new File(['pk'], 'discounts.xlsx', { type: XLSX_TYPE }));

  await user.click(within(dialog).getByLabelText(FIELDS.valueKind));
  await user.click(await screen.findByRole('option', { name: FIELDS.valueKindPercent }));
  await user.type(within(dialog).getByLabelText(FIELDS.value), '20');
  await pickDay(user, FIELDS.startPlaceholder, START_DAY);
  await pickDay(user, FIELDS.endPlaceholder, END_DAY);

  await user.click(within(dialog).getByRole('button', { name: UPLOAD.submit }));
  return dialog;
}

beforeEach(() => {
  push.mockClear();
  toastError.mockClear();
  toastSuccess.mockClear();
  toastWarning.mockClear();
});

describe('<DiscountsListClient> import', () => {
  it('shows a name refusal in the open dialog, with no toast and no navigation', async () => {
    const refusal = validationApiError([{ field: 'name', code: 'NAME_TOO_LONG' }]);
    serve(refusal.problem, refusal.status);
    const { user } = renderClient();

    const dialog = await submitUpload(user);

    expect(
      await within(dialog).findByText(
        tUpload('errors.nameTooLong', { max: UPLOAD_NAME_MAX_LENGTH }),
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();
    expect(toastWarning).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('warns once about the prefilled rows and opens the new list', async () => {
    serve({ ...IMPORT_BODY_WITHOUT_PREFILLED, prefilledRows: PREFILLED_ROWS }, 201);
    const { user } = renderClient();

    await submitUpload(user);

    await waitFor(() => expect(push).toHaveBeenCalledWith(DETAIL_PATH));
    expect(toastWarning).toHaveBeenCalledTimes(1);
    expect(toastWarning).toHaveBeenCalledWith(
      tUpload('prefilledWarning', { count: PREFILLED_ROWS }),
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it('opens the new list without a warning when no row was prefilled', async () => {
    serve({ ...IMPORT_BODY_WITHOUT_PREFILLED, prefilledRows: 0 }, 201);
    const { user } = renderClient();

    await submitUpload(user);

    await waitFor(() => expect(push).toHaveBeenCalledWith(DETAIL_PATH));
    expect(toastWarning).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('opens the new list without a warning when the answer has no prefilledRows', async () => {
    serve(IMPORT_BODY_WITHOUT_PREFILLED, 201);
    const { user } = renderClient();

    await submitUpload(user);

    await waitFor(() => expect(push).toHaveBeenCalledWith(DETAIL_PATH));
    expect(toastWarning).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });
});
