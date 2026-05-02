import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FileUpload, type FileUploadProps } from '@/components/patterns/file-upload';

import { fireEvent, render, screen } from '../helpers/render';

function makeFile(name: string, sizeBytes: number, type: string): File {
  const blob = new Blob([new Uint8Array(sizeBytes)], { type });
  return new File([blob], name, { type });
}

interface HarnessProps extends Omit<FileUploadProps, 'value' | 'onChange'> {
  initialValue?: File | null;
  onChangeSpy?: (next: File | null) => void;
}

function Harness({ initialValue = null, onChangeSpy, ...rest }: HarnessProps): React.ReactElement {
  const [value, setValue] = React.useState<File | null>(initialValue);
  return (
    <FileUpload
      value={value}
      onChange={(next) => {
        setValue(next);
        onChangeSpy?.(next);
      }}
      {...rest}
    />
  );
}

function getHiddenInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('expected hidden <input type="file"> in the FileUpload tree');
  }
  return input;
}

describe('<FileUpload>', () => {
  describe('empty state', () => {
    it('renders the prompt + hint + browse CTA', () => {
      render(<Harness prompt="Hakediş CSV yükle" hint="CSV · max 5 MB" ctaLabel="Dosya seç" />);

      expect(screen.getByText('Hakediş CSV yükle')).toBeInTheDocument();
      expect(screen.getByText('CSV · max 5 MB')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Dosya seç' })).toBeInTheDocument();
    });
  });

  describe('selection', () => {
    it('fires onChange with a valid file selected via the hidden input', async () => {
      const onChangeSpy = vi.fn<(next: File | null) => void>();
      const file = makeFile('hakedis.csv', 1024, 'text/csv');
      const { container, user } = render(
        <Harness onChangeSpy={onChangeSpy} accept="text/csv,.csv" maxSize={5 * 1024 * 1024} />,
      );

      await user.upload(getHiddenInput(container), file);

      expect(onChangeSpy).toHaveBeenCalledWith(file);
    });

    it('rejects a file whose MIME does not match accept and surfaces errorWrongType', () => {
      const onChangeSpy = vi.fn<(next: File | null) => void>();
      const file = makeFile('photo.png', 1024, 'image/png');
      const { container } = render(
        <Harness
          onChangeSpy={onChangeSpy}
          accept="text/csv,.csv"
          errorWrongType="Sadece CSV destekleniyor"
        />,
      );

      // userEvent.upload + happy-dom respect the input's accept attribute and
      // silently drop a non-matching file before the change event fires —
      // browsers in "any file" mode would still surface the file, so we wire
      // the FileList directly to exercise the JS validation path that protects
      // against client-side bypass.
      const input = getHiddenInput(container);
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      fireEvent.change(input);

      expect(onChangeSpy).not.toHaveBeenCalled();
      expect(screen.getByText('Sadece CSV destekleniyor')).toBeInTheDocument();
    });

    it('rejects a file larger than maxSize and surfaces errorTooLarge', async () => {
      const onChangeSpy = vi.fn<(next: File | null) => void>();
      // 2KB file with a 1KB cap.
      const file = makeFile('big.csv', 2 * 1024, 'text/csv');
      const { container, user } = render(
        <Harness
          onChangeSpy={onChangeSpy}
          accept="text/csv,.csv"
          maxSize={1024}
          errorTooLarge="Çok büyük"
        />,
      );

      await user.upload(getHiddenInput(container), file);

      expect(onChangeSpy).not.toHaveBeenCalled();
      expect(screen.getByText('Çok büyük')).toBeInTheDocument();
    });
  });

  describe('filled state', () => {
    it('renders filename + formatted size + remove button', () => {
      const file = makeFile('hakedis-2026-04.csv', 124 * 1024, 'text/csv');
      render(<Harness initialValue={file} removeLabel="Kaldır" />);

      expect(screen.getByText('hakedis-2026-04.csv')).toBeInTheDocument();
      expect(screen.getByText('124 KB')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Kaldır' })).toBeInTheDocument();
    });

    it('formats sizes ≥ 1 MB with one decimal in MB', () => {
      const file = makeFile('big.csv', 2 * 1024 * 1024 + 100 * 1024, 'text/csv');
      render(<Harness initialValue={file} />);

      // 2.1 MB — exact MB_DECIMALS=1 formatting.
      expect(screen.getByText('2.1 MB')).toBeInTheDocument();
    });

    it('clicking the remove button fires onChange(null)', async () => {
      const onChangeSpy = vi.fn<(next: File | null) => void>();
      const file = makeFile('hakedis.csv', 1024, 'text/csv');
      const { user } = render(
        <Harness initialValue={file} onChangeSpy={onChangeSpy} removeLabel="Kaldır" />,
      );

      await user.click(screen.getByRole('button', { name: 'Kaldır' }));

      expect(onChangeSpy).toHaveBeenCalledWith(null);
    });
  });

  describe('error prop', () => {
    it('renders the external error string', () => {
      render(<Harness error="Bu dönem için zaten yüklenmiş" />);
      expect(screen.getByText('Bu dönem için zaten yüklenmiş')).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('replaces the remove button with a status-role spinner when a file is selected', () => {
      const file = makeFile('hakedis.csv', 1024, 'text/csv');
      render(<Harness initialValue={file} loading removeLabel="Kaldır" />);

      expect(screen.queryByRole('button', { name: 'Kaldır' })).not.toBeInTheDocument();
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  describe('disabled state', () => {
    it('takes the dropzone out of the keyboard tab order', () => {
      render(<Harness disabled prompt="Manuel kapalı" />);

      // The dropzone wrapper is the only role="button" in the empty state tree
      // besides the inner CTA (which we set tabIndex={-1} to keep it out of the tab order).
      const dropzone = screen.getByRole('button', { name: /Manuel kapalı/ });
      expect(dropzone).toHaveAttribute('tabIndex', '-1');
      expect(dropzone).toHaveAttribute('aria-disabled', 'true');
    });
  });
});
