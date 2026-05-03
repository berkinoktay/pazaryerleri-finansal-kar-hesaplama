import { NextIntlClientProvider } from 'next-intl';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SearchInput } from '@/components/patterns/search-input';

import trMessages from '../../messages/tr.json';
import { FORMATS } from '../../src/i18n/formats';
import { render, screen } from '../helpers/render';

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

describe('<SearchInput>', () => {
  it('renders the localized default placeholder ("Ara…")', () => {
    renderWithIntl(<SearchInput />);
    expect(screen.getByPlaceholderText('Ara')).toBeInTheDocument();
  });

  it('honours a custom placeholder', () => {
    renderWithIntl(<SearchInput placeholder="Müşteri ara" />);
    expect(screen.getByPlaceholderText('Müşteri ara')).toBeInTheDocument();
  });

  it('uses type=text + inputMode=search per the documented choice in the component', () => {
    const { container } = renderWithIntl(<SearchInput />);
    const input = container.querySelector('input') as HTMLInputElement;
    // Keep type="text", not type="search" — Webkit's native ::-webkit-
    // search-cancel-button would collide with our onClear X (documented
    // in the SearchInput primitive).
    expect(input.getAttribute('type')).toBe('text');
    expect(input.getAttribute('inputmode')).toBe('search');
  });

  it('exposes the clear button only after the user types when onClear is supplied', async () => {
    const onClear = vi.fn();
    const { user } = renderWithIntl(<SearchInput onClear={onClear} />);
    // No clear button while empty.
    expect(screen.queryByRole('button', { name: 'Temizle' })).toBeNull();
    await user.type(screen.getByPlaceholderText('Ara'), 'x');
    // Clear button appears after typing — clicking it fires onClear.
    const clearBtn = screen.getByRole('button', { name: 'Temizle' });
    await user.click(clearBtn);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('does not render a clear button when onClear is omitted', async () => {
    const { user } = renderWithIntl(<SearchInput />);
    await user.type(screen.getByPlaceholderText('Ara'), 'foo');
    expect(screen.queryByRole('button', { name: 'Temizle' })).toBeNull();
  });

  it('honours a custom clearLabel for the aria-label', async () => {
    const { user } = renderWithIntl(<SearchInput onClear={() => {}} clearLabel="Sıfırla" />);
    await user.type(screen.getByPlaceholderText('Ara'), 'x');
    expect(screen.getByRole('button', { name: 'Sıfırla' })).toBeInTheDocument();
  });
});
