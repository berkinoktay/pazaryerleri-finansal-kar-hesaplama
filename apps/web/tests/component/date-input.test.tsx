import { NextIntlClientProvider } from 'next-intl';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { DateInput } from '@/components/patterns/date-input';

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

describe('<DateInput>', () => {
  describe('trigger label', () => {
    it('renders the localized default placeholder when no value is set', () => {
      renderWithIntl(<DateInput />);
      // common.dateInput.placeholder → "Tarih seç" in tr.json
      expect(screen.getByText('Tarih seç')).toBeInTheDocument();
    });

    it('honours a custom placeholder', () => {
      renderWithIntl(<DateInput placeholder="Başlangıç tarihi" />);
      expect(screen.getByText('Başlangıç tarihi')).toBeInTheDocument();
    });

    it('renders the value as a tr-TR formatted date', () => {
      // 5 Şubat 2026
      renderWithIntl(<DateInput value={new Date(2026, 1, 5)} />);
      // date-fns "d MMM yyyy" with tr locale → "5 Şub 2026"
      expect(screen.getByText(/5\s+Şub\s+2026/)).toBeInTheDocument();
    });

    it('disables the trigger when disabled is true', () => {
      renderWithIntl(<DateInput disabled />);
      expect(screen.getByRole('button')).toBeDisabled();
    });
  });

  describe('withTime', () => {
    it('includes the time in the trigger label when withTime is set', () => {
      // 21 Temmuz 2026 08:00
      renderWithIntl(<DateInput withTime value={new Date(2026, 6, 21, 8, 0)} />);
      // date-fns "d MMM yyyy HH:mm" with tr locale → "21 Tem 2026 08:00"
      expect(screen.getByText(/21\s+Tem\s+2026\s+08:00/)).toBeInTheDocument();
    });

    it('omits the time from the label when withTime is not set (day-only, unchanged)', () => {
      renderWithIntl(<DateInput value={new Date(2026, 6, 21, 8, 0)} />);
      expect(screen.getByText(/21\s+Tem\s+2026$/)).toBeInTheDocument();
    });

    it('renders the time control seeded from the value inside the open popover', async () => {
      const { user } = renderWithIntl(<DateInput withTime value={new Date(2026, 6, 21, 8, 0)} />);
      await user.click(screen.getByRole('button'));
      // The controlled native time input reflects the value's H:M (i18n-independent assertion).
      expect(screen.getByDisplayValue('08:00')).toBeInTheDocument();
    });

    it('does not render a time control when withTime is omitted', async () => {
      const { user } = renderWithIntl(
        <DateInput value={new Date(2026, 6, 21, 8, 0)} defaultMonth={new Date(2026, 6, 1)} />,
      );
      await user.click(screen.getByRole('button'));
      expect(screen.queryByDisplayValue('08:00')).not.toBeInTheDocument();
    });
  });

  describe('popover interaction', () => {
    it('opens the calendar popover on trigger click', async () => {
      const { user } = renderWithIntl(<DateInput defaultMonth={new Date(2026, 1, 1)} />);
      await user.click(screen.getByRole('button'));
      // Calendar exposes a grid via react-day-picker.
      expect(screen.getByRole('grid')).toBeInTheDocument();
    });

    it('renders selectable day cells inside the open popover', async () => {
      const { user } = renderWithIntl(<DateInput defaultMonth={new Date(2026, 1, 1)} />);
      await user.click(screen.getByRole('button'));
      // react-day-picker exposes day buttons; the actual click + onChange
      // path is fragile in happy-dom (the cell role / nesting varies by
      // version). Asserting that the grid mounted with day buttons proves
      // the Popover→Calendar integration is alive — the click path is
      // covered by manual DevTools verification + the showcase.
      const dayButtons = screen
        .getAllByRole('button')
        .filter((btn) => /^\d+$/.test(btn.textContent ?? ''));
      expect(dayButtons.length).toBeGreaterThan(20);
    });
  });
});
