import { describe, expect, it, vi } from 'vitest';

import {
  ExportTariffDialog,
  type ExportTariffDialogLabels,
} from '@/features/campaigns/components/export-tariff-dialog';

import { render, screen } from '../helpers/render';

const FILES = [
  { dayCount: 3, count: 2 },
  { dayCount: 4, count: 1 },
  { dayCount: 7, count: 3 },
];

// Labels-as-props (the caller owns the i18n lookup). These mirror the commission
// namespace's Turkish copy so the assertions read the same as before the refactor.
const LABELS: ExportTariffDialogLabels = {
  title: 'Tarifeyi dışa aktar',
  description: 'Seçimlerin aşağıdaki dosyalara aktarılıp indirilecek.',
  fileName: (days) => `${days} Günlük Fiyat`,
  productCount: (count) => `${count} ürün`,
  zipNote: (count) => `${count} dosya tek ZIP olarak inecek.`,
  cancel: 'Vazgeç',
  download: 'İndir',
  saving: 'Seçimler kaydediliyor…',
  exporting: 'İndiriliyor…',
};

describe('ExportTariffDialog', () => {
  it('previews each window file with its product count and confirms on download', async () => {
    const onConfirm = vi.fn();
    const { user } = render(
      <ExportTariffDialog
        open
        onOpenChange={vi.fn()}
        files={FILES}
        labels={LABELS}
        isSaving={false}
        isDownloading={false}
        onConfirm={onConfirm}
      />,
    );

    // fileName = "{days} Günlük Fiyat"; one row per window file.
    expect(screen.getByText('3 Günlük Fiyat')).toBeInTheDocument();
    expect(screen.getByText('4 Günlük Fiyat')).toBeInTheDocument();
    expect(screen.getByText('7 Günlük Fiyat')).toBeInTheDocument();
    // productCount = "{count} ürün".
    expect(screen.getByText('2 ürün')).toBeInTheDocument();
    // More than one file → the ZIP note.
    expect(screen.getByText('3 dosya tek ZIP olarak inecek.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'İndir' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('shows the saving phase and disables the button while selections persist', () => {
    render(
      <ExportTariffDialog
        open
        onOpenChange={vi.fn()}
        files={FILES}
        labels={LABELS}
        isSaving
        isDownloading={false}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /kaydediliyor/i })).toBeDisabled();
  });

  it('shows the downloading phase and disables the button while the file generates', () => {
    render(
      <ExportTariffDialog
        open
        onOpenChange={vi.fn()}
        files={FILES}
        labels={LABELS}
        isSaving={false}
        isDownloading
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /İndiriliyor/ })).toBeDisabled();
  });

  it('omits the ZIP note for a single file', () => {
    render(
      <ExportTariffDialog
        open
        onOpenChange={vi.fn()}
        files={[{ dayCount: 7, count: 1 }]}
        labels={LABELS}
        isSaving={false}
        isDownloading={false}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.queryByText(/ZIP/)).not.toBeInTheDocument();
  });

  it('renders two files with the same day count without a duplicate-key warning', () => {
    // A legacy null day count can tag two files alike; the list keys by position.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      render(
        <ExportTariffDialog
          open
          onOpenChange={vi.fn()}
          files={[
            { dayCount: 4, count: 1 },
            { dayCount: 4, count: 2 },
          ]}
          labels={LABELS}
          isSaving={false}
          isDownloading={false}
          onConfirm={vi.fn()}
        />,
      );
      expect(screen.getAllByText('4 Günlük Fiyat')).toHaveLength(2);
      expect(screen.getByText('1 ürün')).toBeInTheDocument();
      expect(screen.getByText('2 ürün')).toBeInTheDocument();
      const duplicateKeyWarnings = consoleError.mock.calls.filter((args) =>
        args.some((arg) => typeof arg === 'string' && arg.includes('same key')),
      );
      expect(duplicateKeyWarnings).toEqual([]);
    } finally {
      consoleError.mockRestore();
    }
  });
});
