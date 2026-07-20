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
