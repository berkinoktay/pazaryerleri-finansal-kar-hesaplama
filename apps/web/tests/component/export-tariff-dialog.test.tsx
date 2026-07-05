import { describe, expect, it, vi } from 'vitest';

import { ExportTariffDialog } from '@/features/campaigns/components/export-tariff-dialog';

import { render, screen } from '../helpers/render';

const FILES = [
  { dayCount: 3, count: 2 },
  { dayCount: 4, count: 1 },
  { dayCount: 7, count: 3 },
];

describe('ExportTariffDialog', () => {
  it('previews each window file with its product count and confirms on download', async () => {
    const onConfirm = vi.fn();
    const { user } = render(
      <ExportTariffDialog
        open
        onOpenChange={vi.fn()}
        files={FILES}
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
        isSaving={false}
        isDownloading={false}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.queryByText(/ZIP/)).not.toBeInTheDocument();
  });
});
