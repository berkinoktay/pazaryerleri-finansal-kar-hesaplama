import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  MultiFileUpload,
  type MultiFileUploadProps,
} from '@/components/patterns/multi-file-upload';

import { fireEvent, render, screen, within } from '../helpers/render';

function makeFile(name: string, sizeBytes: number, type: string): File {
  const blob = new Blob([new Uint8Array(sizeBytes)], { type });
  return new File([blob], name, { type });
}

interface HarnessProps extends Omit<MultiFileUploadProps, 'value' | 'onChange'> {
  initialValue?: File[];
  onChangeSpy?: (next: File[]) => void;
}

function Harness({ initialValue = [], onChangeSpy, ...rest }: HarnessProps): React.ReactElement {
  const [value, setValue] = React.useState<File[]>(initialValue);
  return (
    <MultiFileUpload
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
    throw new Error('expected hidden <input type="file"> in the MultiFileUpload tree');
  }
  return input;
}

describe('<MultiFileUpload>', () => {
  describe('empty state', () => {
    it('renders the dropzone prompt + browse CTA when no files are present', () => {
      render(
        <Harness
          prompt="Görselleri buraya bırak"
          hint="Max 6 dosya · 5 MB/dosya"
          ctaLabel="Görsel seç"
        />,
      );

      expect(screen.getByText('Görselleri buraya bırak')).toBeInTheDocument();
      expect(screen.getByText('Max 6 dosya · 5 MB/dosya')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Görsel seç' })).toBeInTheDocument();
    });

    it('hidden input has multiple attribute', () => {
      const { container } = render(<Harness />);
      expect(getHiddenInput(container)).toHaveAttribute('multiple');
    });
  });

  describe('selection — appending', () => {
    it('appends picked files to the existing array on commit', () => {
      const onChangeSpy = vi.fn<(next: File[]) => void>();
      const seed = [makeFile('a.csv', 100, 'text/csv')];
      const incoming = makeFile('b.csv', 100, 'text/csv');
      const { container } = render(
        <Harness initialValue={seed} onChangeSpy={onChangeSpy} accept="text/csv,.csv" />,
      );

      const input = getHiddenInput(container);
      Object.defineProperty(input, 'files', { value: [incoming], configurable: true });
      fireEvent.change(input);

      expect(onChangeSpy).toHaveBeenCalledTimes(1);
      const next = onChangeSpy.mock.calls[0][0];
      expect(next).toHaveLength(2);
      expect(next[0]).toBe(seed[0]);
      expect(next[1]).toBe(incoming);
    });
  });

  describe('validation', () => {
    it('rejects an add that would exceed maxFiles and surfaces errorTooMany', () => {
      const onChangeSpy = vi.fn<(next: File[]) => void>();
      const seed = [makeFile('a.csv', 100, 'text/csv'), makeFile('b.csv', 100, 'text/csv')];
      const incoming = [makeFile('c.csv', 100, 'text/csv'), makeFile('d.csv', 100, 'text/csv')];
      const { container } = render(
        <Harness
          initialValue={seed}
          onChangeSpy={onChangeSpy}
          maxFiles={3}
          errorTooMany="En fazla 3 dosya"
        />,
      );

      const input = getHiddenInput(container);
      Object.defineProperty(input, 'files', { value: incoming, configurable: true });
      fireEvent.change(input);

      expect(onChangeSpy).not.toHaveBeenCalled();
      expect(screen.getByText('En fazla 3 dosya')).toBeInTheDocument();
    });

    it('rejects a batch where any file fails accept and surfaces errorWrongType', () => {
      const onChangeSpy = vi.fn<(next: File[]) => void>();
      const incoming = [makeFile('ok.csv', 100, 'text/csv'), makeFile('bad.png', 100, 'image/png')];
      const { container } = render(
        <Harness
          onChangeSpy={onChangeSpy}
          accept="text/csv,.csv"
          errorWrongType="CSV bekleniyor"
        />,
      );

      const input = getHiddenInput(container);
      Object.defineProperty(input, 'files', { value: incoming, configurable: true });
      fireEvent.change(input);

      expect(onChangeSpy).not.toHaveBeenCalled();
      expect(screen.getByText('CSV bekleniyor')).toBeInTheDocument();
    });
  });

  describe('filled state', () => {
    it('renders the header with file count and Add / Remove all CTAs', () => {
      const seed = [makeFile('a.csv', 100, 'text/csv'), makeFile('b.csv', 100, 'text/csv')];
      render(
        <Harness
          initialValue={seed}
          filesCountLabel="Dosyalar"
          addLabel="Dosya ekle"
          removeAllLabel="Tümünü kaldır"
        />,
      );

      expect(screen.getByText('Dosyalar (2)')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Dosya ekle/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Tümünü kaldır/ })).toBeInTheDocument();
    });

    it('renders one list item per file with the per-file remove button', () => {
      const seed = [makeFile('a.csv', 100, 'text/csv'), makeFile('b.csv', 100, 'text/csv')];
      render(<Harness initialValue={seed} removeLabel="Sil" />);

      const items = screen.getAllByRole('listitem');
      expect(items).toHaveLength(2);
      expect(within(items[0]).getByRole('button', { name: 'Sil' })).toBeInTheDocument();
    });

    it('per-file remove fires onChange with the file dropped from the array', async () => {
      const onChangeSpy = vi.fn<(next: File[]) => void>();
      const seed = [makeFile('keep.csv', 100, 'text/csv'), makeFile('drop.csv', 100, 'text/csv')];
      const { user } = render(
        <Harness initialValue={seed} onChangeSpy={onChangeSpy} removeLabel="Sil" />,
      );

      const items = screen.getAllByRole('listitem');
      await user.click(within(items[1]).getByRole('button', { name: 'Sil' }));

      expect(onChangeSpy).toHaveBeenCalledTimes(1);
      const next = onChangeSpy.mock.calls[0][0];
      expect(next).toHaveLength(1);
      expect(next[0].name).toBe('keep.csv');
    });

    it('"Remove all" empties the array', async () => {
      const onChangeSpy = vi.fn<(next: File[]) => void>();
      const seed = [makeFile('a.csv', 100, 'text/csv'), makeFile('b.csv', 100, 'text/csv')];
      const { user } = render(
        <Harness initialValue={seed} onChangeSpy={onChangeSpy} removeAllLabel="Tümünü kaldır" />,
      );

      await user.click(screen.getByRole('button', { name: /Tümünü kaldır/ }));

      expect(onChangeSpy).toHaveBeenCalledWith([]);
    });
  });

  describe('per-file progress', () => {
    it('renders a progress bar for each indexed entry in the progress map', () => {
      const seed = [
        makeFile('one.csv', 100, 'text/csv'),
        makeFile('two.csv', 100, 'text/csv'),
        makeFile('three.csv', 100, 'text/csv'),
      ];
      render(<Harness initialValue={seed} progress={{ 0: 25, 2: 80 }} />);

      const items = screen.getAllByRole('listitem');
      expect(within(items[0]).getByRole('progressbar')).toBeInTheDocument();
      expect(within(items[0]).getByText('25%')).toBeInTheDocument();
      expect(within(items[1]).queryByRole('progressbar')).not.toBeInTheDocument();
      expect(within(items[2]).getByRole('progressbar')).toBeInTheDocument();
      expect(within(items[2]).getByText('80%')).toBeInTheDocument();
    });
  });
});
