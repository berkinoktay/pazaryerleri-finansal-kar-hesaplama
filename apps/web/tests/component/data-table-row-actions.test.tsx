import { within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DataTableRowActions } from '@/components/patterns/data-table-row-actions';

import trMessages from '../../messages/tr.json';
import { FORMATS } from '../../src/i18n/formats';
import { render, screen } from '../helpers/render';

interface Row {
  id: string;
  name: string;
}
const ROW: Row = { id: '1', name: 'Ayşe' };

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider
      locale="tr"
      messages={trMessages}
      formats={FORMATS}
      timeZone="Europe/Istanbul"
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

describe('DataTableRowActions', () => {
  it('opens the kebab menu and fires onSelect with the row', async () => {
    const onEdit = vi.fn();
    const { user } = renderWithIntl(
      <DataTableRowActions row={ROW} actions={[{ label: 'Düzenle', onSelect: onEdit }]} />,
    );
    await user.click(screen.getByRole('button', { name: 'Satır işlemleri' }));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByText('Düzenle'));
    expect(onEdit).toHaveBeenCalledWith(ROW);
  });

  it('renders nothing when there are no actions', () => {
    renderWithIntl(<DataTableRowActions row={ROW} actions={[]} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('disables an item via the per-row predicate', async () => {
    const onDelete = vi.fn();
    const { user } = renderWithIntl(
      <DataTableRowActions
        row={ROW}
        actions={[{ label: 'Sil', tone: 'destructive', onSelect: onDelete, disabled: () => true }]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Satır işlemleri' }));
    const menu = await screen.findByRole('menu');
    const item = within(menu).getByText('Sil').closest('[role="menuitem"]') as HTMLElement;
    expect(item).toHaveAttribute('aria-disabled', 'true');
  });

  it('supports a function that returns per-row actions', async () => {
    const { user } = renderWithIntl(
      <DataTableRowActions
        row={ROW}
        actions={(row) => [{ label: `Aç ${row.name}`, onSelect: () => {} }]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Satır işlemleri' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('Aç Ayşe')).toBeInTheDocument();
  });

  it('tints a warning-tone item amber (e.g. archive)', async () => {
    const { user } = renderWithIntl(
      <DataTableRowActions
        row={ROW}
        actions={[{ label: 'Arşivle', tone: 'warning', onSelect: vi.fn() }]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Satır işlemleri' }));
    const menu = await screen.findByRole('menu');
    const item = within(menu).getByText('Arşivle').closest('[role="menuitem"]') as HTMLElement;
    expect(item).toHaveClass('text-warning');
  });
});
