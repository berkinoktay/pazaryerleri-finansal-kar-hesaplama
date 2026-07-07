import { type ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FlashProductUploadDialog } from '@/features/campaigns/components/flash-product-upload-dialog';

import trMessages from '../../messages/tr.json';
import { render, screen } from '../helpers/render';

const UPLOAD = trMessages.flashProductsPage.upload;
const ERRORS = UPLOAD.errors;
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function makeXlsxFile(name = 'flas-urunler.xlsx'): File {
  return new File(['pk'], name, { type: XLSX_TYPE });
}

/** The dropzone's hidden `<input type="file">` (sr-only, no label). */
function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('file input not found');
  return input;
}

function renderDialog(
  overrides: Partial<Omit<ComponentProps<typeof FlashProductUploadDialog>, 'onFile'>> = {},
) {
  const onFile = vi.fn();
  const result = render(
    <FlashProductUploadDialog open onOpenChange={vi.fn()} onFile={onFile} {...overrides} />,
  );
  return { ...result, onFile };
}

describe('<FlashProductUploadDialog>', () => {
  it('gates submit until a file is chosen, then fires onFile with the picked file', async () => {
    const { user, onFile } = renderDialog();

    const submit = screen.getByRole('button', { name: UPLOAD.submit });
    expect(submit).toBeDisabled(); // no file yet

    const file = makeXlsxFile();
    await user.upload(fileInput(), file);
    expect(submit).toBeEnabled();

    await user.click(submit);
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0]?.[0]).toBe(file);
  });

  it('localizes the EMPTY_FLASH_FILE rejection code', () => {
    renderDialog({ errorCode: 'EMPTY_FLASH_FILE' });
    expect(screen.getByText(ERRORS.empty)).toBeInTheDocument();
  });

  it('localizes the INVALID_FLASH_FORMAT rejection code', () => {
    renderDialog({ errorCode: 'INVALID_FLASH_FORMAT' });
    expect(screen.getByText(ERRORS.wrongFormat)).toBeInTheDocument();
  });

  it('falls back to the generic message for an unknown rejection code', () => {
    renderDialog({ errorCode: 'SOME_UNKNOWN_CODE' });
    expect(screen.getByText(ERRORS.generic)).toBeInTheDocument();
  });

  it('clears the last import error when the seller picks a different file', async () => {
    const onResetError = vi.fn();
    const { user } = renderDialog({ errorCode: 'EMPTY_FLASH_FILE', onResetError });

    // The error copy is shown initially …
    expect(screen.getByText(ERRORS.empty)).toBeInTheDocument();

    // … and picking a new file asks the caller to reset it.
    await user.upload(fileInput(), makeXlsxFile('yeni.xlsx'));
    expect(onResetError).toHaveBeenCalled();
  });
});
