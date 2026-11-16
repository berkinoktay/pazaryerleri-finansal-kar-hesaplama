import { type ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { WORKBOOK_UPLOAD_MAX_BYTES, WORKBOOK_UPLOAD_MAX_MB } from '@pazarsync/utils';

import { DiscountUploadDialog } from '@/features/campaigns/components/discount-upload-dialog';
import { extractFileErrorCode } from '@/features/campaigns/lib/upload-error';
import { ApiError } from '@/lib/api-error';

import trMessages from '../../messages/tr.json';
import { validationApiError } from '../helpers/api-error';
import { fireEvent, render, screen, waitFor, within } from '../helpers/render';

const UPLOAD = trMessages.discountsPage.upload;
const ERRORS = UPLOAD.errors;
const FIELDS = UPLOAD.fields;
const TYPES = trMessages.discountsPage.types;
const SHARED = trMessages.campaignUpload;
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function makeXlsxFile(name = 'indirimler.xlsx'): File {
  return new File(['pk'], name, { type: XLSX_TYPE });
}

/** The dropzone's hidden `<input type="file">` (sr-only, no label). */
function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('file input not found');
  return input;
}

/** The name input's own block (label, input and its message line). */
function nameField(): HTMLElement {
  const block = screen.getByLabelText(UPLOAD.name).parentElement;
  if (block === null) throw new Error('name field block not found');
  return block;
}

function renderDialog(
  overrides: Partial<Omit<ComponentProps<typeof DiscountUploadDialog>, 'onSubmit'>> = {},
) {
  const onSubmit = vi.fn();
  const result = render(
    <DiscountUploadDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} {...overrides} />,
  );
  return { ...result, onSubmit };
}

/** Opens the discount-type Radix Select and picks the option with the given label. */
async function selectDiscountType(
  user: ReturnType<typeof render>['user'],
  optionLabel: string,
): Promise<void> {
  await user.click(screen.getByLabelText(UPLOAD.typeLabel));
  await user.click(await screen.findByRole('option', { name: optionLabel }));
}

describe('<DiscountUploadDialog>', () => {
  it('shows the value fields for the default NET type and hides the buy/pay quantity fields', () => {
    renderDialog();

    // NET renders valueKind + value; the BUY_X_PAY_Y-only quantity fields stay hidden.
    expect(screen.getByLabelText(FIELDS.valueKind)).toBeInTheDocument();
    expect(screen.getByLabelText(FIELDS.value)).toBeInTheDocument();
    expect(screen.queryByLabelText(FIELDS.buyQuantity)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(FIELDS.payQuantity)).not.toBeInTheDocument();
  });

  it('swaps the value fields for buy/pay quantity fields when the type becomes BUY_X_PAY_Y', async () => {
    const { user } = renderDialog();

    await selectDiscountType(user, TYPES.BUY_X_PAY_Y);

    expect(screen.queryByLabelText(FIELDS.valueKind)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(FIELDS.value)).not.toBeInTheDocument();
    expect(screen.getByLabelText(FIELDS.buyQuantity)).toBeInTheDocument();
    expect(screen.getByLabelText(FIELDS.payQuantity)).toBeInTheDocument();
  });

  it('offers buy quantities 2 through 5 (and nothing outside that range)', async () => {
    const { user } = renderDialog();

    await selectDiscountType(user, TYPES.BUY_X_PAY_Y);

    await user.click(screen.getByLabelText(FIELDS.buyQuantity));
    for (const n of ['2', '3', '4', '5']) {
      expect(await screen.findByRole('option', { name: n })).toBeInTheDocument();
    }
    expect(screen.queryByRole('option', { name: '1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '6' })).not.toBeInTheDocument();
  });

  it('offers pay quantities 1 .. buy-1 dependent on the chosen buy (buy=3 -> 1,2)', async () => {
    const { user } = renderDialog();

    await selectDiscountType(user, TYPES.BUY_X_PAY_Y);

    await user.click(screen.getByLabelText(FIELDS.buyQuantity));
    await user.click(await screen.findByRole('option', { name: '3' }));

    await user.click(screen.getByLabelText(FIELDS.payQuantity));
    expect(await screen.findByRole('option', { name: '1' })).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: '2' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '3' })).not.toBeInTheDocument();
  });

  it('snaps an out-of-range pay quantity to buy-1 when buy shrinks (5/4 -> 2/1)', async () => {
    const { user } = renderDialog();

    await selectDiscountType(user, TYPES.BUY_X_PAY_Y);

    // buy = 5, pay = 4 — a valid pair.
    await user.click(screen.getByLabelText(FIELDS.buyQuantity));
    await user.click(await screen.findByRole('option', { name: '5' }));
    await user.click(screen.getByLabelText(FIELDS.payQuantity));
    await user.click(await screen.findByRole('option', { name: '4' }));

    // Shrink buy to 2 — pay 4 is now out of range and snaps to buy-1 = 1.
    await user.click(screen.getByLabelText(FIELDS.buyQuantity));
    await user.click(await screen.findByRole('option', { name: '2' }));

    // Reopening pay proves the snap: the only option is 1, and it is the selected one.
    await user.click(screen.getByLabelText(FIELDS.payQuantity));
    const paySelected = await screen.findByRole('option', { name: '1' });
    expect(paySelected).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('option', { name: '4' })).not.toBeInTheDocument();
  });

  it('clears the value-kind display when the discount type changes (no stale selection)', async () => {
    const { user } = renderDialog();

    // NET + Yüzde (%): pick a value kind under the default type.
    await user.click(screen.getByLabelText(FIELDS.valueKind));
    await user.click(await screen.findByRole('option', { name: FIELDS.valueKindPercent }));
    expect(screen.getByLabelText(FIELDS.valueKind)).toHaveTextContent(FIELDS.valueKindPercent);

    // Switching the kurgu wipes the RHF config state — the Select's DISPLAY must clear with it,
    // otherwise the trigger keeps showing "Yüzde (%)" while submit fails VALUE_KIND_REQUIRED.
    await selectDiscountType(user, TYPES.CONDITIONAL_BASKET);

    const trigger = screen.getByLabelText(FIELDS.valueKind);
    expect(trigger).not.toHaveTextContent(FIELDS.valueKindPercent);
    // Positive contract: the cleared Select shows its placeholder, not a blank trigger.
    expect(trigger).toHaveTextContent(FIELDS.valueKind);

    // Reopening proves the old choice is no longer marked selected.
    await user.click(trigger);
    const percentOption = await screen.findByRole('option', { name: FIELDS.valueKindPercent });
    expect(percentOption).toHaveAttribute('aria-selected', 'false');
  });

  it('offers cart-quantity targets 2 through 4 for NTH_PRODUCT (and nothing outside that range)', async () => {
    const { user } = renderDialog();

    await selectDiscountType(user, TYPES.NTH_PRODUCT);

    // The "X. ürün" target is now a fixed Select (2..4), not a free-text input — an out-of-range
    // target (e.g. 7) is impossible to PICK rather than something a submit-time inline error catches.
    const nthSelect = screen.getByLabelText(FIELDS.nthIndex);
    expect(nthSelect).toBeInTheDocument();

    await user.click(nthSelect);
    for (const n of ['2', '3', '4']) {
      expect(await screen.findByRole('option', { name: n })).toBeInTheDocument();
    }
    expect(screen.queryByRole('option', { name: '1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '5' })).not.toBeInTheDocument();
  });

  it('shows the too-large message inline for a 413 PAYLOAD_TOO_LARGE import error', () => {
    // Wired like the list client: the 413 problem has no `errors[]`, and the global toast
    // pipeline silences PAYLOAD_TOO_LARGE, so the dialog is the only place the seller sees it.
    const error = new ApiError(413, 'PAYLOAD_TOO_LARGE', 'detail', {
      type: 'about:blank',
      title: 'Payload Too Large',
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
      detail: 'detail',
    });
    renderDialog({ errorCode: extractFileErrorCode(error), submitError: error });

    expect(screen.getByText(ERRORS.tooLarge)).toBeInTheDocument();
  });

  it('maps an UNSAFE_CONTENT rejection to the not-readable message', () => {
    renderDialog({ errorCode: 'UNSAFE_CONTENT' });

    expect(screen.getByText(ERRORS.notReadable)).toBeInTheDocument();
  });

  it('shows the shared workbook upload limit in megabytes in the hint', () => {
    renderDialog();

    const expected = UPLOAD.hint.replace('{maxMb}', String(WORKBOOK_UPLOAD_MAX_MB));
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('accepts a file right at the shared workbook upload limit', async () => {
    const { user } = renderDialog();

    const atLimit = new File([new Uint8Array(WORKBOOK_UPLOAD_MAX_BYTES)], 'buyuk.xlsx', {
      type: XLSX_TYPE,
    });
    await user.upload(fileInput(), atLimit);

    expect(screen.getByRole('button', { name: UPLOAD.submit })).toBeEnabled();
  });

  it('limits the name input to the shared name length', () => {
    renderDialog();

    expect(screen.getByLabelText(UPLOAD.name)).toHaveAttribute('maxlength', '120');
  });

  it('shows a NAME_TOO_LONG refusal under the name input, not the generic field message', () => {
    renderDialog({ submitError: validationApiError([{ field: 'name', code: 'NAME_TOO_LONG' }]) });

    expect(
      within(nameField()).getByText(SHARED.errors.nameTooLong.replace('{max}', '120')),
    ).toBeInTheDocument();
    expect(screen.queryByText(UPLOAD.fieldErrors.generic)).not.toBeInTheDocument();
  });

  it('shows a NAME_INVALID_CHARACTERS refusal under the name input', () => {
    renderDialog({
      submitError: validationApiError([{ field: 'name', code: 'NAME_INVALID_CHARACTERS' }]),
    });

    expect(within(nameField()).getByText(SHARED.errors.nameInvalidCharacters)).toBeInTheDocument();
  });

  it('shows the field sentence once for issues on fields the form has no input for', () => {
    renderDialog({
      submitError: validationApiError([
        { field: 'other', code: 'SOME_FUTURE_FIELD_CODE' },
        { field: 'another', code: 'ANOTHER_FUTURE_FIELD_CODE' },
      ]),
    });

    expect(screen.getAllByText(SHARED.errors.field)).toHaveLength(1);
  });

  it('shows the field sentence for a parameter the current kurgu hides', () => {
    // NET is the default kurgu and shows no minimum quantity input.
    renderDialog({
      submitError: validationApiError([{ field: 'minQuantity', code: 'INVALID_MIN_QUANTITY' }]),
    });

    expect(screen.queryByLabelText(FIELDS.minQuantity)).not.toBeInTheDocument();
    expect(screen.getByText(SHARED.errors.field)).toBeInTheDocument();
  });

  it('shows a value issue under the value input and not as the field sentence', async () => {
    renderDialog({
      submitError: validationApiError([{ field: 'value', code: 'INVALID_DISCOUNT_VALUE' }]),
    });

    await waitFor(() =>
      expect(screen.getByLabelText(FIELDS.value)).toHaveAccessibleDescription(
        UPLOAD.fieldErrors.decimal,
      ),
    );
    expect(screen.queryByText(SHARED.errors.field)).not.toBeInTheDocument();
  });

  it('shows a discountType issue under the kurgu picker', async () => {
    renderDialog({
      submitError: validationApiError([{ field: 'discountType', code: 'SOME_TYPE_CODE' }]),
    });

    await waitFor(() =>
      expect(screen.getByLabelText(UPLOAD.typeLabel)).toHaveAccessibleDescription(
        UPLOAD.fieldErrors.generic,
      ),
    );
    expect(screen.queryByText(SHARED.errors.field)).not.toBeInTheDocument();
  });

  it('shows the shared wrong-type message for a file that is not an .xlsx', () => {
    renderDialog();

    // userEvent.upload drops a file the input's `accept` refuses before the change event, so
    // the FileList is wired directly (as in file-upload.test.tsx).
    const input = fileInput();
    Object.defineProperty(input, 'files', {
      value: [new File(['text'], 'notes.txt', { type: 'text/plain' })],
      configurable: true,
    });
    fireEvent.change(input);

    expect(screen.getByText(SHARED.fileErrors.wrongType)).toBeInTheDocument();
  });

  it('labels the remove button with the shared message', async () => {
    const { user } = renderDialog();

    await user.upload(fileInput(), makeXlsxFile());

    expect(screen.getByRole('button', { name: SHARED.removeFile })).toBeInTheDocument();
  });

  it('keeps submit disabled until a file is chosen', async () => {
    const { user } = renderDialog();

    const submit = screen.getByRole('button', { name: UPLOAD.submit });
    expect(submit).toBeDisabled();

    await user.upload(fileInput(), makeXlsxFile());
    expect(submit).toBeEnabled();
  });
});
