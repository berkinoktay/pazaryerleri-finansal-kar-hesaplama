import { NextIntlClientProvider } from 'next-intl';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Combobox, type ComboboxOption } from '@/components/patterns/combobox';

import trMessages from '../../messages/tr.json';
import { render, screen } from '../helpers/render';

const OPTIONS: ComboboxOption[] = [
  { value: 'electronics', label: 'Elektronik', description: 'Telefon, bilgisayar' },
  { value: 'fashion', label: 'Giyim & Moda' },
  { value: 'home', label: 'Ev & Yaşam' },
  { value: 'baby', label: 'Anne & Bebek', disabled: true },
];

interface HarnessProps {
  initialValue?: string | null;
  onChangeSpy?: (next: string | null) => void;
  options?: ComboboxOption[];
  loading?: boolean;
  invalid?: boolean;
  disabled?: boolean;
}

function Harness({
  initialValue = null,
  onChangeSpy,
  options = OPTIONS,
  loading,
  invalid,
  disabled,
}: HarnessProps): React.ReactElement {
  const [value, setValue] = React.useState<string | null>(initialValue);
  return (
    <Combobox
      value={value}
      onChange={(next) => {
        setValue(next);
        onChangeSpy?.(next);
      }}
      options={options}
      loading={loading}
      invalid={invalid}
      disabled={disabled}
    />
  );
}

function renderCombobox(props: HarnessProps = {}) {
  return render(
    <NextIntlClientProvider locale="tr" messages={trMessages}>
      <Harness {...props} />
    </NextIntlClientProvider>,
  );
}

describe('<Combobox>', () => {
  describe('trigger label', () => {
    it('renders the localized placeholder when no value is selected', () => {
      renderCombobox();
      expect(screen.getByRole('button', { name: /Seçim yap/ })).toBeInTheDocument();
    });

    it('renders the matching option label when a value is set', () => {
      renderCombobox({ initialValue: 'electronics' });
      expect(screen.getByRole('button', { name: /Elektronik/ })).toBeInTheDocument();
    });
  });

  describe('opening the popover', () => {
    it('reveals options on trigger click', async () => {
      const { user } = renderCombobox();

      await user.click(screen.getByRole('button', { name: /Seçim yap/ }));

      expect(await screen.findByText('Giyim & Moda')).toBeInTheDocument();
      expect(screen.getByText('Ev & Yaşam')).toBeInTheDocument();
    });
  });

  describe('search filtering', () => {
    it('filters options as the user types in the cmdk input', async () => {
      const { user } = renderCombobox();

      await user.click(screen.getByRole('button', { name: /Seçim yap/ }));
      const search = await screen.findByPlaceholderText('Ara…');
      await user.type(search, 'mod');

      expect(screen.getByText('Giyim & Moda')).toBeInTheDocument();
      expect(screen.queryByText('Elektronik')).not.toBeInTheDocument();
      expect(screen.queryByText('Ev & Yaşam')).not.toBeInTheDocument();
    });

    it('shows the empty message when no option matches', async () => {
      const { user } = renderCombobox();

      await user.click(screen.getByRole('button', { name: /Seçim yap/ }));
      const search = await screen.findByPlaceholderText('Ara…');
      await user.type(search, 'xyz123');

      expect(await screen.findByText('Sonuç bulunamadı')).toBeInTheDocument();
    });
  });

  describe('selection', () => {
    it('fires onChange with the selected value and updates the trigger label', async () => {
      const onChangeSpy = vi.fn();
      const { user } = renderCombobox({ onChangeSpy });

      await user.click(screen.getByRole('button', { name: /Seçim yap/ }));
      await user.click(await screen.findByText('Giyim & Moda'));

      expect(onChangeSpy).toHaveBeenCalledWith('fashion');
      expect(screen.getByRole('button', { name: /Giyim & Moda/ })).toBeInTheDocument();
    });

    it('clears the value when the already-selected option is clicked again', async () => {
      const onChangeSpy = vi.fn();
      const { user } = renderCombobox({ initialValue: 'electronics', onChangeSpy });

      await user.click(screen.getByRole('button', { name: /Elektronik/ }));
      // The selected row appears in the dropdown — click the visible label.
      const items = await screen.findAllByText('Elektronik');
      // First match is the trigger button itself (still in DOM); second is the dropdown row.
      await user.click(items[items.length - 1]);

      expect(onChangeSpy).toHaveBeenLastCalledWith(null);
    });

    it('does not fire onChange when a disabled option is clicked', async () => {
      const onChangeSpy = vi.fn();
      const { user } = renderCombobox({ onChangeSpy });

      await user.click(screen.getByRole('button', { name: /Seçim yap/ }));
      await user.click(await screen.findByText('Anne & Bebek'));

      expect(onChangeSpy).not.toHaveBeenCalled();
    });
  });

  describe('loading state', () => {
    it('renders the spinner via role="status" instead of the chevron', () => {
      renderCombobox({ loading: true });
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  describe('invalid state', () => {
    it('forwards aria-invalid="true" to the trigger', () => {
      renderCombobox({ invalid: true });
      expect(screen.getByRole('button', { name: /Seçim yap/ })).toHaveAttribute(
        'aria-invalid',
        'true',
      );
    });
  });

  describe('disabled state', () => {
    it('marks the trigger as disabled', () => {
      renderCombobox({ disabled: true });
      expect(screen.getByRole('button', { name: /Seçim yap/ })).toBeDisabled();
    });
  });
});
