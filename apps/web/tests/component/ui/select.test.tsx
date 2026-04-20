import { describe, expect, it, vi } from 'vitest';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { render, screen } from '../../helpers/render';

function renderSelect(
  triggerProps: Parameters<typeof SelectTrigger>[0] = {},
): ReturnType<typeof render> {
  return render(
    <Select defaultValue="a">
      <SelectTrigger {...triggerProps}>
        <SelectValue placeholder="Seçin" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="a">A</SelectItem>
        <SelectItem value="b">B</SelectItem>
      </SelectContent>
    </Select>,
  );
}

describe('SelectTrigger primitive', () => {
  describe('invalid prop', () => {
    it('sets aria-invalid="true" on the trigger', () => {
      renderSelect({ invalid: true });
      expect(screen.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true');
    });
  });

  describe('loading state', () => {
    it('sets aria-busy="true" when loading', () => {
      renderSelect({ loading: true });
      expect(screen.getByRole('combobox')).toHaveAttribute('aria-busy', 'true');
    });

    it('renders the spinner with the translated label', () => {
      renderSelect({ loading: true, loadingLabel: 'Yükleniyor' });
      expect(screen.getByRole('status', { name: 'Yükleniyor' })).toBeInTheDocument();
    });
  });

  describe('leadingIcon slot', () => {
    it('renders the leading icon when provided', () => {
      renderSelect({
        leadingIcon: <svg data-testid="lead" aria-hidden="true" />,
      });
      expect(screen.getByTestId('lead')).toBeInTheDocument();
    });
  });

  describe('onClear prop', () => {
    it('renders the clear button with translated aria-label', () => {
      renderSelect({ onClear: vi.fn(), clearLabel: 'Temizle' });
      expect(screen.getByRole('button', { name: 'Temizle' })).toBeInTheDocument();
    });

    it('fires onClear when clicked without opening the dropdown', async () => {
      const onClear = vi.fn();
      const { user } = renderSelect({ onClear, clearLabel: 'Temizle' });

      await user.click(screen.getByRole('button', { name: 'Temizle' }));

      expect(onClear).toHaveBeenCalledOnce();
      // Dropdown should NOT have opened.
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('does not render the clear button when onClear is not provided', () => {
      renderSelect();
      expect(screen.queryByRole('button', { name: /clear|temizle/i })).not.toBeInTheDocument();
    });
  });
});
