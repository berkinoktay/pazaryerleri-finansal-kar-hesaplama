import { describe, expect, it, vi } from 'vitest';

import { FilterChipGroup, type FilterChip } from '@/components/patterns/filter-chip-group';

import { render, screen, within } from '../helpers/render';

const CHIPS: FilterChip[] = [
  { id: 'status', group: 'Durum', label: 'Aktif', onRemove: vi.fn() },
  { id: 'platform', group: 'Pazaryeri', label: 'Trendyol', onRemove: vi.fn() },
  { id: 'category', label: 'Elektronik', onRemove: vi.fn() },
];

describe('<FilterChipGroup>', () => {
  describe('visibility', () => {
    it('renders nothing when chips=[]', () => {
      const { container } = render(<FilterChipGroup chips={[]} />);
      expect(container.firstChild).toBeNull();
    });

    it('renders the role="group" container when chips has items', () => {
      render(<FilterChipGroup chips={CHIPS} />);
      expect(screen.getByRole('group', { name: 'Uygulanan filtreler' })).toBeInTheDocument();
    });
  });

  describe('chip rendering', () => {
    it('renders one pill per chip with the label text', () => {
      render(<FilterChipGroup chips={CHIPS} />);
      expect(screen.getByText('Aktif')).toBeInTheDocument();
      expect(screen.getByText('Trendyol')).toBeInTheDocument();
      expect(screen.getByText('Elektronik')).toBeInTheDocument();
    });

    it('renders the group label with a colon when group is provided', () => {
      render(<FilterChipGroup chips={CHIPS} />);
      // Group label is followed by ":" — search loosely so spacing /
      // wrapping doesn't break the assertion.
      expect(screen.getByText('Durum:')).toBeInTheDocument();
      expect(screen.getByText('Pazaryeri:')).toBeInTheDocument();
    });

    it('omits the group label when group is undefined', () => {
      render(
        <FilterChipGroup chips={[{ id: 'plain', label: 'Sadece value', onRemove: vi.fn() }]} />,
      );
      // No `:` rendered when there's no group.
      expect(screen.queryByText(/:$/)).not.toBeInTheDocument();
    });
  });

  describe('per-chip remove', () => {
    it('renders an X button for each chip with localized aria-label', () => {
      render(<FilterChipGroup chips={CHIPS} />);
      expect(screen.getAllByRole('button', { name: 'Filtreyi kaldır' })).toHaveLength(CHIPS.length);
    });

    it('uses a custom removeLabel when supplied', () => {
      render(
        <FilterChipGroup
          chips={[{ id: 'a', label: 'Foo', onRemove: vi.fn(), removeLabel: 'Sil' }]}
        />,
      );
      expect(screen.getByRole('button', { name: 'Sil' })).toBeInTheDocument();
    });

    it('fires the per-chip onRemove when X is clicked', async () => {
      const onRemove = vi.fn();
      const { user } = render(<FilterChipGroup chips={[{ id: 'a', label: 'Foo', onRemove }]} />);

      await user.click(screen.getByRole('button', { name: 'Filtreyi kaldır' }));
      expect(onRemove).toHaveBeenCalledOnce();
    });

    it('omits the X button when onRemove is not provided (read-only chip)', () => {
      render(<FilterChipGroup chips={[{ id: 'a', label: 'Foo' }]} />);
      expect(screen.queryByRole('button', { name: 'Filtreyi kaldır' })).not.toBeInTheDocument();
    });
  });

  describe('clear all', () => {
    it('renders the "Tümünü temizle" link when onClearAll is provided', () => {
      render(<FilterChipGroup chips={CHIPS} onClearAll={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Tümünü temizle' })).toBeInTheDocument();
    });

    it('uses the supplied clearAllLabel', () => {
      render(
        <FilterChipGroup chips={CHIPS} onClearAll={vi.fn()} clearAllLabel="Hepsini sıfırla" />,
      );
      expect(screen.getByRole('button', { name: 'Hepsini sıfırla' })).toBeInTheDocument();
    });

    it('fires onClearAll when clicked', async () => {
      const onClearAll = vi.fn();
      const { user } = render(<FilterChipGroup chips={CHIPS} onClearAll={onClearAll} />);

      await user.click(screen.getByRole('button', { name: 'Tümünü temizle' }));
      expect(onClearAll).toHaveBeenCalledOnce();
    });

    it('omits the clear-all link when onClearAll is not provided', () => {
      render(<FilterChipGroup chips={CHIPS} />);
      expect(screen.queryByRole('button', { name: 'Tümünü temizle' })).not.toBeInTheDocument();
    });
  });

  describe('icon slot', () => {
    it('renders a per-chip leading icon when supplied', () => {
      render(
        <FilterChipGroup
          chips={[
            {
              id: 'with-icon',
              label: 'Aktif',
              icon: <svg data-testid="custom-glyph" aria-hidden />,
              onRemove: vi.fn(),
            },
          ]}
        />,
      );
      const group = screen.getByRole('group');
      expect(within(group).getByTestId('custom-glyph')).toBeInTheDocument();
    });
  });
});
