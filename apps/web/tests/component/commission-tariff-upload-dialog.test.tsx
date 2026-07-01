import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { CommissionTariffUploadDialog } from '@/features/campaigns/components/commission-tariff-upload-dialog';

import trMessages from '../../messages/tr.json';
import { render, screen } from '../helpers/render';

const UPLOAD = trMessages.commissionTariffsPage.upload;
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function makeXlsxFile(name = 'tarife.xlsx'): File {
  return new File(['pk'], name, { type: XLSX_TYPE });
}

/** The dropzone's hidden `<input type="file">` (sr-only, no label). */
function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('file input not found');
  return input;
}

/** Stateful harness so user-driven close (İptal) and reopen exercise the reset path. */
function Harness({
  onFile = vi.fn(),
  errorCode = null,
  onResetError,
}: {
  onFile?: (file: File) => void;
  errorCode?: string | null;
  onResetError?: () => void;
}): React.ReactElement {
  const [open, setOpen] = React.useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        reopen
      </button>
      <CommissionTariffUploadDialog
        open={open}
        onOpenChange={setOpen}
        onFile={onFile}
        errorCode={errorCode}
        onResetError={onResetError}
      />
    </>
  );
}

describe('<CommissionTariffUploadDialog>', () => {
  it('keeps submit disabled until a file is picked, then submits that file', async () => {
    const onFile = vi.fn();
    const { user } = render(<Harness onFile={onFile} />);

    const submit = screen.getByRole('button', { name: UPLOAD.submit });
    expect(submit).toBeDisabled();

    const file = makeXlsxFile();
    await user.upload(fileInput(), file);
    expect(submit).toBeEnabled();

    await user.click(submit);
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0]?.[0]).toBe(file);
  });

  it('shows the localized message for a known backend file-rejection code', () => {
    render(<Harness errorCode="EMPTY_TARIFF_FILE" />);
    expect(screen.getByText(UPLOAD.errors.empty)).toBeInTheDocument();
  });

  it('falls back to the generic message for an unknown rejection code', () => {
    render(<Harness errorCode="SOME_FUTURE_CODE" />);
    expect(screen.getByText(UPLOAD.errors.generic)).toBeInTheDocument();
  });

  it('clears the previous import error when the seller picks another file', async () => {
    const onResetError = vi.fn();
    const { user } = render(
      <Harness errorCode="INVALID_TARIFF_FORMAT" onResetError={onResetError} />,
    );

    expect(screen.getByText(UPLOAD.errors.wrongFormat)).toBeInTheDocument();
    await user.upload(fileInput(), makeXlsxFile('duzeltilmis.xlsx'));
    expect(onResetError).toHaveBeenCalled();
  });

  it('resets the picked file when the dialog is closed, so reopening starts clean', async () => {
    const { user } = render(<Harness />);

    await user.upload(fileInput(), makeXlsxFile());
    expect(screen.getByRole('button', { name: UPLOAD.submit })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: trMessages.common.cancel }));
    expect(screen.queryByRole('button', { name: UPLOAD.submit })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'reopen' }));
    expect(screen.getByRole('button', { name: UPLOAD.submit })).toBeDisabled();
  });
});
