import { type ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MarketplaceCampaignUploadDialog } from '@/features/campaigns/components/marketplace-campaign-upload-dialog';

import trMessages from '../../../../messages/tr.json';
import { validationApiError } from '../../../helpers/api-error';
import { fireEvent, render, screen, waitFor, within } from '../../../helpers/render';

const UPLOAD = trMessages.marketplaceCampaignsPage.upload;
const FIELDS = trMessages.discountsPage.upload.fields;
const FIELD_ERRORS = trMessages.discountsPage.upload.fieldErrors;
const TYPES = trMessages.discountsPage.types;
const SHARED = trMessages.campaignUpload;
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const CAMPAIGN_TYPES = [
  'NET',
  'CONDITIONAL_BASKET',
  'CONDITIONAL_QUANTITY',
  'BUY_X_PAY_Y',
  'NTH_PRODUCT',
] as const;

function makeXlsxFile(name = 'kampanya.xlsx'): File {
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
  overrides: Partial<Omit<ComponentProps<typeof MarketplaceCampaignUploadDialog>, 'onSubmit'>> = {},
) {
  const onSubmit = vi.fn();
  const result = render(
    <MarketplaceCampaignUploadDialog
      open
      onOpenChange={vi.fn()}
      onSubmit={onSubmit}
      {...overrides}
    />,
  );
  return { ...result, onSubmit };
}

/** Opens the kurgu Radix Select and picks the option with the given label. */
async function selectKurgu(
  user: ReturnType<typeof render>['user'],
  optionLabel: string,
): Promise<void> {
  await user.click(screen.getByLabelText(UPLOAD.typeLabel));
  await user.click(await screen.findByRole('option', { name: optionLabel }));
}

describe('<MarketplaceCampaignUploadDialog>', () => {
  it('offers the five campaign kurgu and not the coupon one', async () => {
    const { user } = renderDialog();

    await user.click(screen.getByLabelText(UPLOAD.typeLabel));
    for (const type of CAMPAIGN_TYPES) {
      expect(await screen.findByRole('option', { name: TYPES[type] })).toBeInTheDocument();
    }
    expect(screen.queryByRole('option', { name: TYPES.CODE })).not.toBeInTheDocument();
  });

  it('swaps the parameter fields with the kurgu (NET -> BUY_X_PAY_Y)', async () => {
    const { user } = renderDialog();

    expect(screen.getByLabelText(FIELDS.valueKind)).toBeInTheDocument();
    expect(screen.queryByLabelText(FIELDS.buyQuantity)).not.toBeInTheDocument();

    await selectKurgu(user, TYPES.BUY_X_PAY_Y);

    expect(screen.queryByLabelText(FIELDS.valueKind)).not.toBeInTheDocument();
    expect(screen.getByLabelText(FIELDS.buyQuantity)).toBeInTheDocument();
    expect(screen.getByLabelText(FIELDS.payQuantity)).toBeInTheDocument();
  });

  it('clears the previous kurgu value kind on a kurgu change but keeps the funding rate', async () => {
    const { user } = renderDialog();

    await user.type(screen.getByLabelText(UPLOAD.fundingLabel), '60');
    await user.click(screen.getByLabelText(FIELDS.valueKind));
    await user.click(await screen.findByRole('option', { name: FIELDS.valueKindPercent }));

    await selectKurgu(user, TYPES.CONDITIONAL_BASKET);

    // The funding rate is not a per-kurgu parameter, so it survives the change.
    expect(screen.getByLabelText(UPLOAD.fundingLabel)).toHaveValue('60');
    // The value kind's DISPLAY clears with the state — the placeholder shows, not the old pick.
    const trigger = screen.getByLabelText(FIELDS.valueKind);
    expect(trigger).not.toHaveTextContent(FIELDS.valueKindPercent);
    expect(trigger).toHaveTextContent(FIELDS.valueKind);
    await user.click(trigger);
    const percentOption = await screen.findByRole('option', { name: FIELDS.valueKindPercent });
    expect(percentOption).toHaveAttribute('aria-selected', 'false');
  });

  it('shows the funding-rate error inline instead of submitting a rate above 100', async () => {
    const { user, onSubmit } = renderDialog();

    await user.upload(fileInput(), makeXlsxFile());
    await user.type(screen.getByLabelText(UPLOAD.fundingLabel), '150');
    await user.click(screen.getByRole('button', { name: UPLOAD.submit }));

    expect(await screen.findByText(UPLOAD.fieldErrors.fundingOver100)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
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
    expect(screen.queryByText(FIELD_ERRORS.generic)).not.toBeInTheDocument();
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
      expect(screen.getByLabelText(FIELDS.value)).toHaveAccessibleDescription(FIELD_ERRORS.decimal),
    );
    expect(screen.queryByText(SHARED.errors.field)).not.toBeInTheDocument();
  });

  it('shows a funding rate issue under its input and not as the field sentence', async () => {
    renderDialog({
      submitError: validationApiError([
        { field: 'trendyolFundingPct', code: 'FUNDING_PCT_OVER_100' },
      ]),
    });

    expect(await screen.findByText(UPLOAD.fieldErrors.fundingOver100)).toBeInTheDocument();
    expect(screen.queryByText(SHARED.errors.field)).not.toBeInTheDocument();
  });

  it('shows a discountType issue under the kurgu picker', async () => {
    renderDialog({
      submitError: validationApiError([{ field: 'discountType', code: 'SOME_TYPE_CODE' }]),
    });

    await waitFor(() =>
      expect(screen.getByLabelText(UPLOAD.typeLabel)).toHaveAccessibleDescription(
        FIELD_ERRORS.generic,
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
