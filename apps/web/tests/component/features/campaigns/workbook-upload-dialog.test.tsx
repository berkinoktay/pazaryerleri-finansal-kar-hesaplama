import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The commission source picker links to the commission tariff page with next-intl's localized
// <Link>, which pulls in `next/navigation` (unresolvable under happy-dom). The dialog module
// imports the picker for every page, so every case needs the stub.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import {
  UPLOAD_NAME_MAX_LENGTH,
  WORKBOOK_PAGES,
  WORKBOOK_UPLOAD_MAX_BYTES,
  WORKBOOK_UPLOAD_MAX_MB,
  type WorkbookPage,
} from '@pazarsync/utils';

import type { WorkbookImportInput } from '@/features/campaigns/api/workbook-endpoints';
import { WorkbookUploadDialog } from '@/features/campaigns/components/workbook-upload-dialog';
import { useWorkbookErrorMessage } from '@/features/campaigns/hooks/use-workbook-error-message';

import trMessages from '../../../../messages/tr.json';
import { problemApiError, validationApiError } from '../../../helpers/api-error';
import { HttpResponse, http, server } from '../../../helpers/msw';
import {
  AllProviders,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '../../../helpers/render';

const SHARED = trMessages.campaignUpload;
const COMMON = trMessages.common;
const SOURCE = trMessages.productLabelsPage.upload.commissionSource;
const DISCOUNT_UPLOAD = trMessages.discountsPage.upload;
const CAMPAIGN_UPLOAD = trMessages.marketplaceCampaignsPage.upload;
const FIELDS = DISCOUNT_UPLOAD.fields;
const FIELD_ERRORS = DISCOUNT_UPLOAD.fieldErrors;
const TYPES = trMessages.discountsPage.types;

const SCOPE = {
  orgId: '00000000-0000-0000-0000-0000000000aa',
  storeId: '00000000-0000-0000-0000-0000000000bb',
};
const COMMISSION_LIST =
  'http://localhost:3001/v1/organizations/:orgId/stores/:storeId/commission-tariffs';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const NAME_TOO_LONG = SHARED.errors.nameTooLong.replace('{max}', String(UPLOAD_NAME_MAX_LENGTH));
// Mid-month days: neither is ever an outside day of the calendar.
const EARLY_DAY = '10';
const LATE_DAY = '20';

/**
 * The six pages, written out here rather than read from the dialog's own config, so a page that
 * loses its title, its own refusal sentences or its guide is caught by this table. A null
 * `duplicateWeek` means the page uses the shared sentence.
 */
const PAGE_ROWS = [
  {
    page: WORKBOOK_PAGES.COMMISSION_TARIFF,
    title: trMessages.commissionTariffsPage.upload.title,
    submit: trMessages.commissionTariffsPage.upload.submit,
    wrongFormat: trMessages.commissionTariffsPage.upload.errors.wrongFormat,
    duplicateWeek: trMessages.commissionTariffsPage.upload.errors.duplicateWeek,
    steps: [
      trMessages.commissionTariffsPage.upload.step1,
      trMessages.commissionTariffsPage.upload.step2,
      trMessages.commissionTariffsPage.upload.step3,
    ],
  },
  {
    page: WORKBOOK_PAGES.PLUS_COMMISSION_TARIFF,
    title: trMessages.plusCommissionTariffsPage.upload.title,
    submit: trMessages.plusCommissionTariffsPage.upload.submit,
    wrongFormat: trMessages.plusCommissionTariffsPage.upload.errors.wrongFormat,
    duplicateWeek: trMessages.plusCommissionTariffsPage.upload.errors.duplicateWeek,
    steps: [
      trMessages.plusCommissionTariffsPage.upload.step1,
      trMessages.plusCommissionTariffsPage.upload.step2,
      trMessages.plusCommissionTariffsPage.upload.step3,
    ],
  },
  {
    page: WORKBOOK_PAGES.ADVANTAGE_TARIFF,
    title: trMessages.productLabelsPage.upload.title,
    submit: trMessages.productLabelsPage.upload.submit,
    wrongFormat: trMessages.productLabelsPage.upload.errors.wrongFormat,
    duplicateWeek: null,
    steps: [
      trMessages.productLabelsPage.upload.step1,
      trMessages.productLabelsPage.upload.step2,
      trMessages.productLabelsPage.upload.step3,
    ],
  },
  {
    page: WORKBOOK_PAGES.FLASH_PRODUCT_LIST,
    title: trMessages.flashProductsPage.upload.title,
    submit: trMessages.flashProductsPage.upload.submit,
    wrongFormat: trMessages.flashProductsPage.upload.errors.wrongFormat,
    duplicateWeek: null,
    steps: [
      trMessages.flashProductsPage.upload.step1,
      trMessages.flashProductsPage.upload.step2,
      trMessages.flashProductsPage.upload.step3,
    ],
  },
  {
    page: WORKBOOK_PAGES.DISCOUNT_LIST,
    title: DISCOUNT_UPLOAD.title,
    submit: DISCOUNT_UPLOAD.submit,
    wrongFormat: DISCOUNT_UPLOAD.errors.wrongFormat,
    duplicateWeek: null,
    steps: null,
  },
  {
    page: WORKBOOK_PAGES.MARKETPLACE_CAMPAIGN_LIST,
    title: CAMPAIGN_UPLOAD.title,
    submit: CAMPAIGN_UPLOAD.submit,
    wrongFormat: CAMPAIGN_UPLOAD.errors.wrongFormat,
    duplicateWeek: null,
    steps: null,
  },
] as const;

/** The step guide titles of every page that has one, to prove a page without one shows none. */
const STEP_GUIDE_TITLES = [
  trMessages.commissionTariffsPage.upload.stepsTitle,
  trMessages.plusCommissionTariffsPage.upload.stepsTitle,
  trMessages.productLabelsPage.upload.stepsTitle,
  trMessages.flashProductsPage.upload.stepsTitle,
] as const;

/** The two pages whose upload carries a typed config, with what each emits for a NET 20% config. */
const CONFIG_ROWS = [
  {
    page: WORKBOOK_PAGES.DISCOUNT_LIST,
    upload: DISCOUNT_UPLOAD,
    netConfig: { discountType: 'NET', valueKind: 'PERCENT', value: '20' },
  },
  {
    page: WORKBOOK_PAGES.MARKETPLACE_CAMPAIGN_LIST,
    upload: CAMPAIGN_UPLOAD,
    // An empty funding rate is sent as an explicit "0".
    netConfig: { discountType: 'NET', valueKind: 'PERCENT', value: '20', trendyolFundingPct: '0' },
  },
] as const;

function makeXlsxFile(name = 'upload.xlsx'): File {
  return new File(['pk'], name, { type: XLSX_TYPE });
}

/** A 422 whose only issue is on `file`. */
function fileIssue(code: string): Error {
  return validationApiError([{ field: 'file', code }]);
}

/** The dropzone's hidden `<input type="file">` (sr-only, no label). */
function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('file input not found');
  return input;
}

/** Wires a FileList straight to the input: userEvent.upload drops a file `accept` refuses. */
function dropFile(file: File): void {
  const input = fileInput();
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

function tariff(
  id: string,
  weekStartsAt: string,
  weekEndsAt: string,
  validity: 'active' | 'upcoming' | 'past',
): Record<string, unknown> {
  return {
    id,
    name: `tariff-${id}`,
    productCount: 10,
    selectedCount: 0,
    exported: false,
    validity,
    weekStartsAt,
    weekEndsAt,
    updatedAt: '2026-07-01T00:00:00Z',
  };
}

const ACTIVE_TARIFF = tariff('t-active', '2026-07-01T05:00:00Z', '2026-07-08T04:59:00Z', 'active');
const UPCOMING_TARIFF = tariff(
  't-next',
  '2026-07-08T05:00:00Z',
  '2026-07-15T04:59:00Z',
  'upcoming',
);

/** Serves the store's commission tariff list (the commission source picker's data). */
function serveCommissionList(data: readonly unknown[]): void {
  server.use(http.get(COMMISSION_LIST, () => HttpResponse.json({ data })));
}

/** The sentence the shared error hook gives for `error` on `page`. */
function hookMessage(page: WorkbookPage, error: Error): string | null {
  const { result } = renderHook(() => useWorkbookErrorMessage(page), { wrapper: AllProviders });
  return result.current(error);
}

interface HarnessProps {
  page: WorkbookPage;
  onSubmit?: (input: WorkbookImportInput) => void;
  onOpenChange?: (open: boolean) => void;
  submitting?: boolean;
  submitError?: Error | null;
  onResetError?: () => void;
}

/** Stateful harness, so a close by the cancel button and a reopen exercise the reset path. */
function Harness({
  page,
  onSubmit = vi.fn(),
  onOpenChange,
  submitting = false,
  submitError = null,
  onResetError,
}: HarnessProps): React.ReactElement {
  const [open, setOpen] = React.useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        reopen
      </button>
      <WorkbookUploadDialog
        page={page}
        open={open}
        onOpenChange={(next) => {
          onOpenChange?.(next);
          setOpen(next);
        }}
        scope={SCOPE}
        onSubmit={onSubmit}
        submitting={submitting}
        submitError={submitError}
        onResetError={onResetError}
      />
    </>
  );
}

type User = ReturnType<typeof render>['user'];

/** Picks a day in the date input showing `placeholder`, then closes its popover. */
async function pickDay(user: User, placeholder: string, day: string): Promise<void> {
  await user.click(screen.getByRole('button', { name: placeholder }));
  const grid = await screen.findByRole('grid');
  const dayButton = within(grid)
    .getAllByRole('button')
    .find((button) => button.textContent === day);
  if (dayButton === undefined) throw new Error(`day ${day} not found`);
  await user.click(dayButton);
  await user.click(screen.getByRole('button', { name: COMMON.dateInput.done }));
}

/** Opens a Radix Select by its label and picks the option with the given label. */
async function selectOption(user: User, label: string, option: string): Promise<void> {
  await user.click(screen.getByLabelText(label));
  await user.click(await screen.findByRole('option', { name: option }));
}

/** Fills a valid NET 20% config with a window from the 10th to the 20th of the month. */
async function fillNetConfig(user: User): Promise<void> {
  await selectOption(user, FIELDS.valueKind, FIELDS.valueKindPercent);
  await user.type(screen.getByLabelText(FIELDS.value), '20');
  await pickDay(user, FIELDS.startPlaceholder, EARLY_DAY);
  await pickDay(user, FIELDS.endPlaceholder, LATE_DAY);
}

beforeEach(() => {
  // Every row mounts the dialog, and the advantage row reads the commission tariff list:
  // the MSW server refuses an unhandled request, so the list is always served.
  serveCommissionList([ACTIVE_TARIFF]);
});

describe('<WorkbookUploadDialog> page table', () => {
  it('covers every workbook page exactly once', () => {
    expect(PAGE_ROWS.map((row) => row.page).sort()).toEqual(Object.values(WORKBOOK_PAGES).sort());
  });
});

describe.each(PAGE_ROWS)('<WorkbookUploadDialog page="$page">', (row) => {
  it('keeps submit disabled until a file is picked', async () => {
    const { user } = render(<Harness page={row.page} />);

    const submit = screen.getByRole('button', { name: row.submit });
    expect(submit).toBeDisabled();

    await user.upload(fileInput(), makeXlsxFile());
    await waitFor(() => expect(submit).toBeEnabled());
  });

  it("shows the page's title and the shared dropzone texts", () => {
    render(<Harness page={row.page} />);

    expect(screen.getByRole('heading', { name: row.title })).toBeInTheDocument();
    expect(screen.getByText(SHARED.prompt)).toBeInTheDocument();
    expect(
      screen.getByText(SHARED.hint.replace('{maxMb}', String(WORKBOOK_UPLOAD_MAX_MB))),
    ).toBeInTheDocument();
    expect(screen.getByText(SHARED.cta)).toBeInTheDocument();
  });

  it('shows the three-step guide exactly when the page has one', () => {
    render(<Harness page={row.page} />);

    if (row.steps === null) {
      for (const title of STEP_GUIDE_TITLES) {
        expect(screen.queryByText(title)).not.toBeInTheDocument();
      }
      return;
    }
    for (const step of row.steps) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }
  });

  it.each([
    ['EMPTY_FILE', fileIssue('EMPTY_FILE')],
    ['DUPLICATE_WEEK', fileIssue('DUPLICATE_WEEK')],
    ['UNSAFE_CONTENT', fileIssue('UNSAFE_CONTENT')],
    ['an unknown file code', fileIssue('SOME_FUTURE_CODE')],
    ['the 413', problemApiError(413, 'PAYLOAD_TOO_LARGE')],
  ])('shows the sentence of the shared error hook for %s', (_label, error) => {
    render(<Harness page={row.page} submitError={error} />);

    const expected = hookMessage(row.page, error);
    if (expected === null) throw new Error('the hook gave no sentence for a file refusal');
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("shows the page's own wrong-format sentence for WRONG_FILE_FOR_PAGE", () => {
    render(<Harness page={row.page} submitError={fileIssue('WRONG_FILE_FOR_PAGE')} />);

    expect(screen.getByText(row.wrongFormat)).toBeInTheDocument();
  });

  it("shows the page's own duplicate-week sentence, or the shared one", () => {
    render(<Harness page={row.page} submitError={fileIssue('DUPLICATE_WEEK')} />);

    expect(screen.getByText(row.duplicateWeek ?? SHARED.errors.duplicateWeek)).toBeInTheDocument();
  });

  it('shows a name refusal exactly once, whether or not the page has a name input', () => {
    render(
      <Harness
        page={row.page}
        submitError={validationApiError([{ field: 'name', code: 'NAME_TOO_LONG' }])}
      />,
    );

    expect(screen.getAllByText(NAME_TOO_LONG)).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent(NAME_TOO_LONG);
  });

  it('shows the field sentence once for issues on fields the page has no input for', () => {
    render(
      <Harness
        page={row.page}
        submitError={validationApiError([
          { field: 'other', code: 'SOME_FUTURE_FIELD_CODE' },
          { field: 'another', code: 'ANOTHER_FUTURE_FIELD_CODE' },
        ])}
      />,
    );

    expect(screen.getAllByText(SHARED.errors.field)).toHaveLength(1);
  });

  it('renders no alert and no dropzone error for a 409, which the global toast owns', () => {
    render(<Harness page={row.page} submitError={problemApiError(409, 'IMPORT_IN_PROGRESS')} />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fileInput()).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText(SHARED.errors.generic)).not.toBeInTheDocument();
  });

  it('asks to clear the previous error when another file is picked', async () => {
    const onResetError = vi.fn();
    const { user } = render(
      <Harness page={row.page} submitError={fileIssue('EMPTY_FILE')} onResetError={onResetError} />,
    );

    await user.upload(fileInput(), makeXlsxFile('fixed.xlsx'));

    expect(onResetError).toHaveBeenCalled();
  });

  it('shows the shared wrong-type sentence for a file that is not an .xlsx', () => {
    render(<Harness page={row.page} />);

    dropFile(new File(['text'], 'notes.txt', { type: 'text/plain' }));

    expect(screen.getByText(SHARED.fileErrors.wrongType)).toBeInTheDocument();
  });

  it('labels the remove button with the shared sentence', async () => {
    const { user } = render(<Harness page={row.page} />);

    await user.upload(fileInput(), makeXlsxFile());

    expect(screen.getByRole('button', { name: SHARED.removeFile })).toBeInTheDocument();
  });

  it('starts with an empty dropzone after a close and a reopen, and clears the error', async () => {
    const onResetError = vi.fn();
    const { user } = render(<Harness page={row.page} onResetError={onResetError} />);

    await user.upload(fileInput(), makeXlsxFile());
    expect(screen.getByRole('button', { name: SHARED.removeFile })).toBeInTheDocument();
    onResetError.mockClear();

    await user.click(screen.getByRole('button', { name: COMMON.cancel }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onResetError).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'reopen' }));
    expect(screen.queryByRole('button', { name: SHARED.removeFile })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: row.submit })).toBeDisabled();
  });
});

// A close or a new file while the import is in flight would reset the import mutation, and
// the reset drops the success callback that closes the dialog and routes to the new record.
describe.each(PAGE_ROWS)('<WorkbookUploadDialog page="$page"> while importing', (row) => {
  it('disables the cancel button', () => {
    render(<Harness page={row.page} submitting />);

    expect(screen.getByRole('button', { name: COMMON.cancel })).toBeDisabled();
  });

  it('ignores Escape: the dialog stays open and nothing is reset', async () => {
    const onOpenChange = vi.fn();
    const onResetError = vi.fn();
    const { user } = render(
      <Harness
        page={row.page}
        submitting
        onOpenChange={onOpenChange}
        onResetError={onResetError}
      />,
    );

    await user.keyboard('{Escape}');

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onResetError).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('accepts no new file in the empty dropzone', async () => {
    const onResetError = vi.fn();
    const { user } = render(<Harness page={row.page} submitting onResetError={onResetError} />);

    expect(fileInput()).toBeDisabled();
    await user.upload(fileInput(), makeXlsxFile());

    expect(screen.queryByRole('button', { name: SHARED.removeFile })).not.toBeInTheDocument();
    expect(onResetError).not.toHaveBeenCalled();
  });

  it('keeps the picked file: its remove button is disabled', async () => {
    const onResetError = vi.fn();
    const { user, rerender } = render(<Harness page={row.page} onResetError={onResetError} />);

    await user.upload(fileInput(), makeXlsxFile());
    onResetError.mockClear();
    rerender(<Harness page={row.page} submitting onResetError={onResetError} />);

    const remove = screen.getByRole('button', { name: SHARED.removeFile });
    expect(remove).toBeDisabled();
    await user.click(remove);
    expect(screen.getByRole('button', { name: SHARED.removeFile })).toBeInTheDocument();
    expect(onResetError).not.toHaveBeenCalled();
  });

  it('closes on Escape and clears the error once the import is no longer in flight', async () => {
    const onOpenChange = vi.fn();
    const onResetError = vi.fn();
    const { user } = render(
      <Harness page={row.page} onOpenChange={onOpenChange} onResetError={onResetError} />,
    );

    expect(screen.getByRole('button', { name: COMMON.cancel })).toBeEnabled();
    await user.keyboard('{Escape}');

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onResetError).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('<WorkbookUploadDialog> dropzone limit', () => {
  it('accepts a file right at the shared workbook upload limit', async () => {
    const { user } = render(<Harness page={WORKBOOK_PAGES.COMMISSION_TARIFF} />);

    const atLimit = new File([new Uint8Array(WORKBOOK_UPLOAD_MAX_BYTES)], 'large.xlsx', {
      type: XLSX_TYPE,
    });
    await user.upload(fileInput(), atLimit);

    expect(screen.queryByText(SHARED.fileErrors.tooLarge)).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: trMessages.commissionTariffsPage.upload.submit }),
    ).toBeEnabled();
  });
});

describe('<WorkbookUploadDialog> files only', () => {
  it.each([
    [WORKBOOK_PAGES.COMMISSION_TARIFF, trMessages.commissionTariffsPage.upload.submit],
    [WORKBOOK_PAGES.PLUS_COMMISSION_TARIFF, trMessages.plusCommissionTariffsPage.upload.submit],
    [WORKBOOK_PAGES.FLASH_PRODUCT_LIST, trMessages.flashProductsPage.upload.submit],
  ])('%s emits the picked file with no fields', async (page, submitLabel) => {
    const onSubmit = vi.fn<(input: WorkbookImportInput) => void>();
    const { user } = render(<Harness page={page} onSubmit={onSubmit} />);

    const file = makeXlsxFile();
    await user.upload(fileInput(), file);
    await user.click(screen.getByRole('button', { name: submitLabel }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0].file).toBe(file);
    expect(onSubmit.mock.calls[0]?.[0].fields).toEqual({});
  });
});

describe('<WorkbookUploadDialog page="ADVANTAGE_TARIFF">', () => {
  const PAGE = WORKBOOK_PAGES.ADVANTAGE_TARIFF;
  const SUBMIT = trMessages.productLabelsPage.upload.submit;

  it('pins the nearest upcoming tariff by default and emits it', async () => {
    serveCommissionList([ACTIVE_TARIFF, UPCOMING_TARIFF]);
    const onSubmit = vi.fn<(input: WorkbookImportInput) => void>();
    const { user } = render(<Harness page={PAGE} onSubmit={onSubmit} />);

    const file = makeXlsxFile();
    await user.upload(fileInput(), file);
    const submit = screen.getByRole('button', { name: SUBMIT });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      file,
      fields: { commissionSourceTariffId: 't-next' },
    });
  });

  it('preselects nothing without a tariff and keeps submit disabled until a choice', async () => {
    serveCommissionList([]);
    const { user } = render(<Harness page={PAGE} />);

    // It renders without a re-render loop: the empty-source guidance shows.
    expect(await screen.findByText(SOURCE.empty)).toBeInTheDocument();
    expect(screen.getByText(SOURCE.required)).toBeInTheDocument();
    await user.upload(fileInput(), makeXlsxFile());
    const submit = screen.getByRole('button', { name: SUBMIT });
    expect(submit).toBeDisabled();

    await user.click(screen.getByText(SOURCE.categoryOption));

    expect(submit).toBeEnabled();
  });

  it('drops the category choice on a close and pins the default tariff again on reopen', async () => {
    serveCommissionList([ACTIVE_TARIFF, UPCOMING_TARIFF]);
    const onSubmit = vi.fn<(input: WorkbookImportInput) => void>();
    const { user } = render(<Harness page={PAGE} onSubmit={onSubmit} />);

    await user.click(await screen.findByText(SOURCE.categoryOption));
    await user.click(screen.getByRole('button', { name: COMMON.cancel }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'reopen' }));

    const file = makeXlsxFile();
    await user.upload(fileInput(), file);
    const submit = screen.getByRole('button', { name: SUBMIT });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      file,
      fields: { commissionSourceTariffId: 't-next' },
    });
  });

  it('emits no commissionSourceTariffId for the category choice', async () => {
    const onSubmit = vi.fn<(input: WorkbookImportInput) => void>();
    const { user } = render(<Harness page={PAGE} onSubmit={onSubmit} />);

    const file = makeXlsxFile();
    await user.upload(fileInput(), file);
    await user.click(await screen.findByText(SOURCE.categoryOption));
    await user.click(screen.getByRole('button', { name: SUBMIT }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0].file).toBe(file);
    expect(onSubmit.mock.calls[0]?.[0].fields).not.toHaveProperty('commissionSourceTariffId');
  });

  it('shows a commissionSourceTariffId issue under the picker, and only there', async () => {
    render(
      <Harness
        page={PAGE}
        submitError={validationApiError([
          { field: 'commissionSourceTariffId', code: 'SOME_SOURCE_CODE' },
        ])}
      />,
    );

    const picker = screen.getByRole('group', { name: SOURCE.title });
    expect(within(picker).getByRole('alert')).toHaveTextContent(SHARED.errors.field);
    expect(screen.getAllByText(SHARED.errors.field)).toHaveLength(1);
    // Let the tariff list settle so the picker's update lands inside the test.
    await waitFor(() =>
      expect(within(picker).getByLabelText(SOURCE.tariffOption)).not.toHaveAttribute(
        'aria-busy',
        'true',
      ),
    );
  });
});

describe.each(CONFIG_ROWS)('<WorkbookUploadDialog page="$page"> config', (row) => {
  const UPLOAD = row.upload;

  /** The name input's own block (label, input and its message line). */
  function nameField(): HTMLElement {
    const block = screen.getByLabelText(UPLOAD.name).parentElement;
    if (block === null) throw new Error('name field block not found');
    return block;
  }

  it('swaps the parameter fields with the discount type', async () => {
    const { user } = render(<Harness page={row.page} />);

    // NET shows the value kind and value; the BUY_X_PAY_Y quantities stay hidden.
    expect(screen.getByLabelText(FIELDS.valueKind)).toBeInTheDocument();
    expect(screen.getByLabelText(FIELDS.value)).toBeInTheDocument();
    expect(screen.queryByLabelText(FIELDS.buyQuantity)).not.toBeInTheDocument();

    await selectOption(user, UPLOAD.typeLabel, TYPES.BUY_X_PAY_Y);

    expect(screen.queryByLabelText(FIELDS.valueKind)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(FIELDS.value)).not.toBeInTheDocument();
    expect(screen.getByLabelText(FIELDS.buyQuantity)).toBeInTheDocument();
    expect(screen.getByLabelText(FIELDS.payQuantity)).toBeInTheDocument();
  });

  it("clears the previous type's values when the discount type changes", async () => {
    const { user } = render(<Harness page={row.page} />);

    await selectOption(user, FIELDS.valueKind, FIELDS.valueKindPercent);
    expect(screen.getByLabelText(FIELDS.valueKind)).toHaveTextContent(FIELDS.valueKindPercent);

    await selectOption(user, UPLOAD.typeLabel, TYPES.CONDITIONAL_BASKET);

    const trigger = screen.getByLabelText(FIELDS.valueKind);
    expect(trigger).not.toHaveTextContent(FIELDS.valueKindPercent);
    // The cleared Select shows its placeholder, not a blank trigger.
    expect(trigger).toHaveTextContent(FIELDS.valueKind);
    await user.click(trigger);
    const percentOption = await screen.findByRole('option', { name: FIELDS.valueKindPercent });
    expect(percentOption).toHaveAttribute('aria-selected', 'false');
  });

  it('shows endBeforeStart for an end before the start, and emits nothing', async () => {
    const onSubmit = vi.fn<(input: WorkbookImportInput) => void>();
    const { user } = render(<Harness page={row.page} onSubmit={onSubmit} />);

    await user.upload(fileInput(), makeXlsxFile());
    await selectOption(user, FIELDS.valueKind, FIELDS.valueKindPercent);
    await user.type(screen.getByLabelText(FIELDS.value), '20');
    await pickDay(user, FIELDS.startPlaceholder, LATE_DAY);
    await pickDay(user, FIELDS.endPlaceholder, EARLY_DAY);
    await user.click(screen.getByRole('button', { name: UPLOAD.submit }));

    expect(await screen.findByText(FIELD_ERRORS.endBeforeStart)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('emits the trimmed name and every config value', async () => {
    const onSubmit = vi.fn<(input: WorkbookImportInput) => void>();
    const { user } = render(<Harness page={row.page} onSubmit={onSubmit} />);

    const file = makeXlsxFile();
    await user.upload(fileInput(), file);
    await user.type(screen.getByLabelText(UPLOAD.name), '  Liste  ');
    await fillNetConfig(user);
    await user.click(screen.getByRole('button', { name: UPLOAD.submit }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0].file).toBe(file);
    expect(onSubmit.mock.calls[0]?.[0].fields).toEqual({
      name: 'Liste',
      ...row.netConfig,
      startsAt: expect.any(String),
      endsAt: expect.any(String),
    });
  });

  it('leaves the name out when none was typed', async () => {
    const onSubmit = vi.fn<(input: WorkbookImportInput) => void>();
    const { user } = render(<Harness page={row.page} onSubmit={onSubmit} />);

    await user.upload(fileInput(), makeXlsxFile());
    await fillNetConfig(user);
    await user.click(screen.getByRole('button', { name: UPLOAD.submit }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0].fields).not.toHaveProperty('name');
  });

  it('submits on Enter in the name input and keeps the dialog open', async () => {
    const onSubmit = vi.fn<(input: WorkbookImportInput) => void>();
    const onOpenChange = vi.fn();
    const { user } = render(
      <Harness page={row.page} onSubmit={onSubmit} onOpenChange={onOpenChange} />,
    );

    await user.upload(fileInput(), makeXlsxFile());
    await fillNetConfig(user);
    await user.type(screen.getByLabelText(UPLOAD.name), 'Liste{Enter}');

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('starts from an empty name and the default NET config after a close and a reopen', async () => {
    const { user } = render(<Harness page={row.page} />);

    // The type first: a type change clears the parameters itself, so the value comes after it.
    await selectOption(user, UPLOAD.typeLabel, TYPES.CONDITIONAL_BASKET);
    await user.type(screen.getByLabelText(UPLOAD.name), 'Liste');
    await user.type(screen.getByLabelText(FIELDS.value), '20');
    expect(screen.getByLabelText(FIELDS.value)).toHaveValue('20');

    await user.click(screen.getByRole('button', { name: COMMON.cancel }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'reopen' }));

    expect(screen.getByLabelText(UPLOAD.name)).toHaveValue('');
    expect(screen.getByLabelText(UPLOAD.typeLabel)).toHaveTextContent(TYPES.NET);
    expect(screen.getByLabelText(FIELDS.value)).toHaveValue('');
  });

  it('limits the name input to the shared name length', () => {
    render(<Harness page={row.page} />);

    expect(screen.getByLabelText(UPLOAD.name)).toHaveAttribute(
      'maxlength',
      String(UPLOAD_NAME_MAX_LENGTH),
    );
  });

  it('shows a NAME_TOO_LONG refusal under the name input, not the generic field message', () => {
    render(
      <Harness
        page={row.page}
        submitError={validationApiError([{ field: 'name', code: 'NAME_TOO_LONG' }])}
      />,
    );

    expect(within(nameField()).getByText(NAME_TOO_LONG)).toBeInTheDocument();
    expect(screen.queryByText(FIELD_ERRORS.generic)).not.toBeInTheDocument();
  });

  it('shows a NAME_INVALID_CHARACTERS refusal under the name input', () => {
    render(
      <Harness
        page={row.page}
        submitError={validationApiError([{ field: 'name', code: 'NAME_INVALID_CHARACTERS' }])}
      />,
    );

    expect(within(nameField()).getByText(SHARED.errors.nameInvalidCharacters)).toBeInTheDocument();
  });

  it('shows the field sentence for a parameter the current discount type hides', () => {
    // NET is the default discount type and shows no minimum quantity input.
    render(
      <Harness
        page={row.page}
        submitError={validationApiError([{ field: 'minQuantity', code: 'INVALID_MIN_QUANTITY' }])}
      />,
    );

    expect(screen.queryByLabelText(FIELDS.minQuantity)).not.toBeInTheDocument();
    expect(screen.getByText(SHARED.errors.field)).toBeInTheDocument();
  });

  it('shows a value issue under the value input and not as the field sentence', async () => {
    render(
      <Harness
        page={row.page}
        submitError={validationApiError([{ field: 'value', code: 'INVALID_DISCOUNT_VALUE' }])}
      />,
    );

    await waitFor(() =>
      expect(screen.getByLabelText(FIELDS.value)).toHaveAccessibleDescription(FIELD_ERRORS.decimal),
    );
    expect(screen.queryByText(SHARED.errors.field)).not.toBeInTheDocument();
  });

  it('shows a discountType issue under the discount type picker', async () => {
    render(
      <Harness
        page={row.page}
        submitError={validationApiError([{ field: 'discountType', code: 'SOME_TYPE_CODE' }])}
      />,
    );

    await waitFor(() =>
      expect(screen.getByLabelText(UPLOAD.typeLabel)).toHaveAccessibleDescription(
        FIELD_ERRORS.generic,
      ),
    );
    expect(screen.queryByText(SHARED.errors.field)).not.toBeInTheDocument();
  });

  it('shows a DATE_OUT_OF_RANGE refusal with the two years written as plain numbers', async () => {
    render(
      <Harness
        page={row.page}
        submitError={validationApiError([{ field: 'startsAt', code: 'DATE_OUT_OF_RANGE' }])}
      />,
    );

    expect(
      await screen.findByText(
        FIELD_ERRORS.dateOutOfRange.replace('{min}', '1900').replace('{max}', '9999'),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/1\.900|9\.999/)).not.toBeInTheDocument();
    expect(screen.queryByText(SHARED.errors.field)).not.toBeInTheDocument();
  });

  it('shows an INVALID_DATE refusal under the date', async () => {
    render(
      <Harness
        page={row.page}
        submitError={validationApiError([{ field: 'startsAt', code: 'INVALID_DATE' }])}
      />,
    );

    expect(await screen.findByText(FIELD_ERRORS.dateInvalid)).toBeInTheDocument();
    expect(screen.queryByText(SHARED.errors.field)).not.toBeInTheDocument();
  });
});

describe('<WorkbookUploadDialog page="DISCOUNT_LIST"> buy and pay quantities', () => {
  const PAGE = WORKBOOK_PAGES.DISCOUNT_LIST;

  it('offers buy quantities 2 through 5 (and nothing outside that range)', async () => {
    const { user } = render(<Harness page={PAGE} />);

    await selectOption(user, DISCOUNT_UPLOAD.typeLabel, TYPES.BUY_X_PAY_Y);
    await user.click(screen.getByLabelText(FIELDS.buyQuantity));

    for (const n of ['2', '3', '4', '5']) {
      expect(await screen.findByRole('option', { name: n })).toBeInTheDocument();
    }
    expect(screen.queryByRole('option', { name: '1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '6' })).not.toBeInTheDocument();
  });

  it('offers pay quantities 1 .. buy-1 dependent on the chosen buy (buy=3 -> 1,2)', async () => {
    const { user } = render(<Harness page={PAGE} />);

    await selectOption(user, DISCOUNT_UPLOAD.typeLabel, TYPES.BUY_X_PAY_Y);
    await selectOption(user, FIELDS.buyQuantity, '3');
    await user.click(screen.getByLabelText(FIELDS.payQuantity));

    expect(await screen.findByRole('option', { name: '1' })).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: '2' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '3' })).not.toBeInTheDocument();
  });

  it('snaps an out-of-range pay quantity to buy-1 when buy shrinks (5/4 -> 2/1)', async () => {
    const { user } = render(<Harness page={PAGE} />);

    await selectOption(user, DISCOUNT_UPLOAD.typeLabel, TYPES.BUY_X_PAY_Y);
    await selectOption(user, FIELDS.buyQuantity, '5');
    await selectOption(user, FIELDS.payQuantity, '4');
    await selectOption(user, FIELDS.buyQuantity, '2');

    // Reopening pay proves the snap: the only option is 1, and it is the selected one.
    await user.click(screen.getByLabelText(FIELDS.payQuantity));
    const paySelected = await screen.findByRole('option', { name: '1' });
    expect(paySelected).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('option', { name: '4' })).not.toBeInTheDocument();
  });

  it('offers cart-quantity targets 2 through 4 for NTH_PRODUCT (and nothing outside that range)', async () => {
    const { user } = render(<Harness page={PAGE} />);

    await selectOption(user, DISCOUNT_UPLOAD.typeLabel, TYPES.NTH_PRODUCT);
    await user.click(screen.getByLabelText(FIELDS.nthIndex));

    for (const n of ['2', '3', '4']) {
      expect(await screen.findByRole('option', { name: n })).toBeInTheDocument();
    }
    expect(screen.queryByRole('option', { name: '1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '5' })).not.toBeInTheDocument();
  });
});

describe('<WorkbookUploadDialog page="MARKETPLACE_CAMPAIGN_LIST"> funding rate', () => {
  const PAGE = WORKBOOK_PAGES.MARKETPLACE_CAMPAIGN_LIST;
  const CAMPAIGN_TYPES = [
    'NET',
    'CONDITIONAL_BASKET',
    'CONDITIONAL_QUANTITY',
    'BUY_X_PAY_Y',
    'NTH_PRODUCT',
  ] as const;

  it('offers the five campaign discount types and not the coupon one', async () => {
    const { user } = render(<Harness page={PAGE} />);

    await user.click(screen.getByLabelText(CAMPAIGN_UPLOAD.typeLabel));

    for (const type of CAMPAIGN_TYPES) {
      expect(await screen.findByRole('option', { name: TYPES[type] })).toBeInTheDocument();
    }
    expect(screen.queryByRole('option', { name: TYPES.CODE })).not.toBeInTheDocument();
  });

  it('keeps the funding rate across a discount type change', async () => {
    const { user } = render(<Harness page={PAGE} />);

    await user.type(screen.getByLabelText(CAMPAIGN_UPLOAD.fundingLabel), '60');
    await selectOption(user, CAMPAIGN_UPLOAD.typeLabel, TYPES.CONDITIONAL_BASKET);

    expect(screen.getByLabelText(CAMPAIGN_UPLOAD.fundingLabel)).toHaveValue('60');
  });

  it('shows the funding rate error inline instead of submitting a rate above 100', async () => {
    const onSubmit = vi.fn<(input: WorkbookImportInput) => void>();
    const { user } = render(<Harness page={PAGE} onSubmit={onSubmit} />);

    await user.upload(fileInput(), makeXlsxFile());
    await user.type(screen.getByLabelText(CAMPAIGN_UPLOAD.fundingLabel), '150');
    await user.click(screen.getByRole('button', { name: CAMPAIGN_UPLOAD.submit }));

    expect(await screen.findByText(CAMPAIGN_UPLOAD.fieldErrors.fundingOver100)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows a funding rate issue under its input and not as the field sentence', async () => {
    render(
      <Harness
        page={PAGE}
        submitError={validationApiError([
          { field: 'trendyolFundingPct', code: 'FUNDING_PCT_OVER_100' },
        ])}
      />,
    );

    expect(await screen.findByText(CAMPAIGN_UPLOAD.fieldErrors.fundingOver100)).toBeInTheDocument();
    expect(screen.queryByText(SHARED.errors.field)).not.toBeInTheDocument();
  });
});
