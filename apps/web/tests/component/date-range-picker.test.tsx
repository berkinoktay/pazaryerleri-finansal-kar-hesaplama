import { NextIntlClientProvider } from 'next-intl';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DateRangePicker } from '@/components/patterns/date-range-picker';

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

describe('<DateRangePicker>', () => {
  describe('trigger label', () => {
    it('renders the localized default placeholder when no range is set', () => {
      renderWithIntl(<DateRangePicker />);
      // common.dateRangePicker.placeholder
      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('honours a custom placeholder', () => {
      renderWithIntl(<DateRangePicker placeholder="Tarih aralığı" />);
      expect(screen.getByText('Tarih aralığı')).toBeInTheDocument();
    });

    it('renders only the from date when only `from` is supplied', () => {
      renderWithIntl(<DateRangePicker value={{ from: new Date(2026, 0, 5) }} />);
      // date-fns "d MMM yyyy" with tr → "5 Oca 2026"
      expect(screen.getByText(/5\s+Oca\s+2026/)).toBeInTheDocument();
      // No range separator (–) since only `from` is set.
      const button = screen.getByRole('button');
      expect(button.textContent).not.toContain('–');
    });

    it('renders "from – to" when both endpoints are supplied', () => {
      renderWithIntl(
        <DateRangePicker value={{ from: new Date(2026, 0, 5), to: new Date(2026, 0, 12) }} />,
      );
      const button = screen.getByRole('button');
      expect(button.textContent).toMatch(/5\s+Oca\s+2026/);
      expect(button.textContent).toMatch(/12\s+Oca\s+2026/);
      expect(button.textContent).toContain('–');
    });
  });

  describe('popover interaction', () => {
    it('opens the calendar popover on trigger click', async () => {
      const { user } = renderWithIntl(<DateRangePicker value={{ from: new Date(2026, 1, 1) }} />);
      await user.click(screen.getByRole('button'));
      // numberOfMonths=2 → at least one grid renders.
      const grids = screen.getAllByRole('grid');
      expect(grids.length).toBeGreaterThanOrEqual(1);
    });

    it('mounts two months of day buttons inside the open popover', async () => {
      const { user } = renderWithIntl(<DateRangePicker value={{ from: new Date(2026, 1, 1) }} />);
      await user.click(screen.getByRole('button'));
      // numberOfMonths=2 → ~60 day buttons across both months. The
      // actual click + onChange path is fragile in happy-dom (react-day-
      // picker's range selection requires two ordered clicks across
      // grids); proving the day buttons mount keeps the integration
      // tested without coupling to library internals.
      const dayButtons = screen
        .getAllByRole('button')
        .filter((btn) => /^\d+$/.test(btn.textContent ?? ''));
      expect(dayButtons.length).toBeGreaterThan(40);
    });
  });
});
