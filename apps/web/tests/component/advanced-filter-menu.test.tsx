import { describe, expect, it, vi } from 'vitest';

import { AdvancedFilterMenu } from '@/components/patterns/advanced-filter-menu';
import type { FilterFieldDef, FilterRow } from '@/lib/advanced-filter';

import { render, screen } from '../helpers/render';

// A small mock catalog covering the three editor shapes: a money RANGE field, a
// fixed-set ENUM (multi-select), and a one-tap FLAG. Labels arrive already
// localized (the FilterFieldDef contract), so the component only needs the
// `common.advancedFilter.*` keys — supplied by the default render's tr.json.
const FIELDS: FilterFieldDef[] = [
  {
    key: 'salePrice',
    label: 'Satış fiyatı',
    groupLabel: 'Aralık',
    dataType: 'money',
    operators: ['between', 'gte', 'lte', 'eq'],
    unit: '₺',
  },
  {
    key: 'vatRate',
    label: 'KDV oranı',
    groupLabel: 'Özellik',
    dataType: 'enumFixed',
    operators: ['in'],
    enumValues: [
      { value: '0', label: '%0' },
      { value: '1', label: '%1' },
      { value: '10', label: '%10' },
      { value: '20', label: '%20' },
    ],
  },
  {
    key: 'missingCost',
    label: 'Maliyeti boş',
    groupLabel: 'Bayrak',
    dataType: 'flag',
    operators: ['isTrue'],
  },
  {
    key: 'status',
    label: 'Durum',
    groupLabel: 'Özellik',
    dataType: 'enumSingle',
    operators: ['eq'],
    enumValues: [
      { value: 'onSale', label: 'Satışta' },
      { value: 'archived', label: 'Arşivde' },
    ],
  },
];

function priceRow(value: [string, string]): FilterRow {
  return { id: 'r-price', field: 'salePrice', operator: 'between', value };
}

describe('AdvancedFilterMenu', () => {
  it('renders the add button and one chip per committed filter', () => {
    render(<AdvancedFilterMenu fields={FIELDS} value={[priceRow(['20', ''])]} onApply={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Filtre ekle/ })).toBeInTheDocument();
    // The chip body reads "key: value": money bounds render through the shared
    // `currency` preset (matching the table's Currency cells), and the open
    // bound shows the infinity glyph.
    const chip = screen.getByRole('button', { name: /Satış fiyatı/ });
    expect(chip).toHaveTextContent('₺20,00');
    expect(chip).toHaveTextContent('∞');
  });

  it('removes a chip when its remove control is clicked', async () => {
    const onApply = vi.fn();
    const { user } = render(
      <AdvancedFilterMenu fields={FIELDS} value={[priceRow(['20', ''])]} onApply={onApply} />,
    );
    await user.click(screen.getByRole('button', { name: 'Filtreyi kaldır' }));
    expect(onApply).toHaveBeenCalledWith([]);
  });

  it('adds a flag filter in a single tap (no editor)', async () => {
    const onApply = vi.fn();
    const { user } = render(<AdvancedFilterMenu fields={FIELDS} value={[]} onApply={onApply} />);
    await user.click(screen.getByRole('button', { name: /Filtre ekle/ }));
    await user.click(await screen.findByText('Maliyeti boş'));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ field: 'missingCost', operator: 'isTrue' }),
    ]);
  });

  it('opens the value editor and commits a range on Uygula (gated until valued)', async () => {
    const onApply = vi.fn();
    const { user } = render(<AdvancedFilterMenu fields={FIELDS} value={[]} onApply={onApply} />);
    await user.click(screen.getByRole('button', { name: /Filtre ekle/ }));
    await user.click(await screen.findByText('Satış fiyatı'));

    // Default operator is "between" → min/max inputs; Uygula stays disabled until
    // a usable bound is typed.
    const apply = screen.getByRole('button', { name: 'Uygula' });
    expect(apply).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'En az' }), '20');
    expect(apply).toBeEnabled();
    await user.click(apply);

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ field: 'salePrice', operator: 'between', value: ['20', ''] }),
    ]);
  });

  it('discards an in-progress edit when İptal is clicked', async () => {
    const onApply = vi.fn();
    const { user } = render(<AdvancedFilterMenu fields={FIELDS} value={[]} onApply={onApply} />);
    await user.click(screen.getByRole('button', { name: /Filtre ekle/ }));
    await user.click(await screen.findByText('Satış fiyatı'));
    await user.type(screen.getByRole('textbox', { name: 'En az' }), '20');
    await user.click(screen.getByRole('button', { name: 'İptal' }));
    expect(onApply).not.toHaveBeenCalled();
  });

  it('edits an existing chip and commits the change with the same id', async () => {
    const onApply = vi.fn();
    const { user } = render(
      <AdvancedFilterMenu fields={FIELDS} value={[priceRow(['20', ''])]} onApply={onApply} />,
    );
    await user.click(screen.getByRole('button', { name: /Satış fiyatı/ }));
    await user.type(screen.getByRole('textbox', { name: 'En çok' }), '400');
    await user.click(screen.getByRole('button', { name: 'Uygula' }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]?.[0]).toEqual([
      { id: 'r-price', field: 'salePrice', operator: 'between', value: ['20', '400'] },
    ]);
  });

  it('commits a multi-select enum filter', async () => {
    const onApply = vi.fn();
    const { user } = render(<AdvancedFilterMenu fields={FIELDS} value={[]} onApply={onApply} />);
    await user.click(screen.getByRole('button', { name: /Filtre ekle/ }));
    await user.click(await screen.findByText('KDV oranı'));
    await user.click(await screen.findByText('%10'));
    await user.click(screen.getByRole('button', { name: 'Uygula' }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ field: 'vatRate', operator: 'in', value: ['10'] }),
    ]);
  });

  it('removes only the clicked chip and keeps the correct survivor (by id)', async () => {
    const onApply = vi.fn();
    const vatRow: FilterRow = { id: 'r-vat', field: 'vatRate', operator: 'in', value: ['10'] };
    const { user } = render(
      <AdvancedFilterMenu
        fields={FIELDS}
        value={[priceRow(['20', '']), vatRow]}
        onApply={onApply}
      />,
    );
    const removeButtons = screen.getAllByRole('button', { name: 'Filtreyi kaldır' });
    expect(removeButtons).toHaveLength(2);
    await user.click(removeButtons[0]!); // the first chip = salePrice
    expect(onApply).toHaveBeenCalledWith([vatRow]);
  });

  it('toggles a multi-select option off (deselect re-disables Uygula)', async () => {
    const { user } = render(<AdvancedFilterMenu fields={FIELDS} value={[]} onApply={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Filtre ekle/ }));
    await user.click(await screen.findByText('KDV oranı'));
    const apply = screen.getByRole('button', { name: 'Uygula' });
    await user.click(await screen.findByText('%10')); // select
    expect(apply).toBeEnabled();
    await user.click(screen.getByText('%10')); // deselect the same option
    expect(apply).toBeDisabled();
  });

  it('summarizes 3+ selected enum values as a count', () => {
    render(
      <AdvancedFilterMenu
        fields={FIELDS}
        value={[{ id: 'r-vat', field: 'vatRate', operator: 'in', value: ['0', '1', '10'] }]}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /KDV oranı/ })).toHaveTextContent('3 seçili');
  });

  it('hides an already-applied field from the add menu (no duplicate dimension)', async () => {
    const { user } = render(
      <AdvancedFilterMenu fields={FIELDS} value={[priceRow(['20', ''])]} onApply={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: /Filtre ekle/ }));
    // the other dimensions are still offered…
    expect(await screen.findByText('KDV oranı')).toBeInTheDocument();
    expect(screen.getByText('Maliyeti boş')).toBeInTheDocument();
    // …but the already-applied salePrice is NOT a second time: only the chip
    // carries "Satış fiyatı", not also a selectable menu item.
    expect(screen.getAllByText(/Satış fiyatı/)).toHaveLength(1);
  });

  it('enumSingle commits a single value and picking another REPLACES it (radio semantics)', async () => {
    const onApply = vi.fn();
    const { user } = render(<AdvancedFilterMenu fields={FIELDS} value={[]} onApply={onApply} />);
    await user.click(screen.getByRole('button', { name: /Filtre ekle/ }));
    await user.click(await screen.findByText('Durum'));

    const apply = screen.getByRole('button', { name: 'Uygula' });
    expect(apply).toBeDisabled();
    await user.click(await screen.findByText('Arşivde'));
    // Picking a second option replaces the first — no multi-select set.
    await user.click(screen.getByText('Satışta'));
    expect(apply).toBeEnabled();
    await user.click(apply);

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ field: 'status', operator: 'eq', value: 'onSale' }),
    ]);
  });

  it('drops leaked editing state when the edited row leaves value externally (browser Back/Forward)', async () => {
    const onApply = vi.fn();
    const { user, rerender } = render(
      <AdvancedFilterMenu fields={FIELDS} value={[priceRow(['20', ''])]} onApply={onApply} />,
    );
    // Open the editor and buffer an uncommitted draft.
    await user.click(screen.getByRole('button', { name: /Satış fiyatı/ }));
    await user.type(screen.getByRole('textbox', { name: 'En çok' }), '999');

    // The row disappears without any in-page pointer event (browser Back with
    // URL-owned filters), then returns with the SAME id (browser Forward).
    rerender(<AdvancedFilterMenu fields={FIELDS} value={[]} onApply={onApply} />);
    rerender(
      <AdvancedFilterMenu fields={FIELDS} value={[priceRow(['20', ''])]} onApply={onApply} />,
    );

    // The editor must NOT spontaneously reopen with the abandoned draft.
    expect(screen.queryByRole('button', { name: 'Uygula' })).not.toBeInTheDocument();

    // Reopening seeds from the committed row — the stale '999' draft is gone.
    await user.click(screen.getByRole('button', { name: /Satış fiyatı/ }));
    expect(screen.getByRole('textbox', { name: 'En çok' })).toHaveValue('');
  });

  it('discards an in-progress chip edit when the popover is dismissed with Escape', async () => {
    const onApply = vi.fn();
    const { user } = render(
      <AdvancedFilterMenu fields={FIELDS} value={[priceRow(['20', ''])]} onApply={onApply} />,
    );
    await user.click(screen.getByRole('button', { name: /Satış fiyatı/ })); // open editor
    await user.type(screen.getByRole('textbox', { name: 'En çok' }), '999');
    await user.keyboard('{Escape}');
    expect(onApply).not.toHaveBeenCalled();
  });
});
