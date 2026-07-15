import { type ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DiscountUploadDialog } from '@/features/campaigns/components/discount-upload-dialog';

import trMessages from '../../messages/tr.json';
import { render, screen } from '../helpers/render';

const UPLOAD = trMessages.discountsPage.upload;
const FIELDS = UPLOAD.fields;
const FIELD_ERRORS = UPLOAD.fieldErrors;
const TYPES = trMessages.discountsPage.types;
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

  it('shows the out-of-range inline error for an NTH_PRODUCT target index outside 2–4', async () => {
    const { user, onSubmit } = renderDialog();

    await selectDiscountType(user, TYPES.NTH_PRODUCT);
    await user.type(screen.getByLabelText(FIELDS.nthIndex), '7');

    // A file is required to enable submit — the config is only validated on submit.
    await user.upload(fileInput(), makeXlsxFile());
    await user.click(screen.getByRole('button', { name: UPLOAD.submit }));

    expect(await screen.findByText(FIELD_ERRORS.nthRange)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps submit disabled until a file is chosen', async () => {
    const { user } = renderDialog();

    const submit = screen.getByRole('button', { name: UPLOAD.submit });
    expect(submit).toBeDisabled();

    await user.upload(fileInput(), makeXlsxFile());
    expect(submit).toBeEnabled();
  });
});
