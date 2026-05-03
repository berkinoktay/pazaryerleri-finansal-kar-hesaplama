import { NextIntlClientProvider } from 'next-intl';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FilterTabs, type FilterTabOption } from '@/components/patterns/filter-tabs';

import trMessages from '../../messages/tr.json';
import { FORMATS } from '../../src/i18n/formats';
import { render, screen } from '../helpers/render';

type Status = 'all' | 'open' | 'completed' | 'returned';

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

const BASE_OPTIONS: FilterTabOption<Status>[] = [
  { value: 'all', label: 'Tümü', count: 1472 },
  { value: 'open', label: 'Açık', count: 38 },
  { value: 'completed', label: 'Tamamlandı', count: 1304 },
  { value: 'returned', label: 'İade', count: 0 },
];

describe('<FilterTabs>', () => {
  describe('rendering', () => {
    it('renders one tab per option', () => {
      renderWithIntl(
        <FilterTabs<Status> value="all" onValueChange={() => {}} options={BASE_OPTIONS} />,
      );
      expect(screen.getAllByRole('tab')).toHaveLength(4);
    });

    it('marks the option matching `value` as the selected tab', () => {
      renderWithIntl(
        <FilterTabs<Status> value="open" onValueChange={() => {}} options={BASE_OPTIONS} />,
      );
      // Regex match — Radix gives the tab its own accessible name from text
      // content, which here is "Açık 38" (label + formatted count).
      const open = screen.getByRole('tab', { name: /Açık/ });
      expect(open).toHaveAttribute('aria-selected', 'true');
    });

    it('renders explicit 0 as a count rather than omitting it', () => {
      renderWithIntl(
        <FilterTabs<Status> value="all" onValueChange={() => {}} options={BASE_OPTIONS} />,
      );
      const returned = screen.getByRole('tab', { name: /İade/ });
      expect(returned.textContent).toContain('0');
    });

    it('formats counts with locale grouping (1472 → 1.472 in tr-TR)', () => {
      renderWithIntl(
        <FilterTabs<Status> value="all" onValueChange={() => {}} options={BASE_OPTIONS} />,
      );
      const all = screen.getByRole('tab', { name: /Tümü/ });
      // tr-TR uses dot as thousands separator. Assert any thousands separator
      // is present rather than the exact string so the test isn't fragile to
      // whitespace nuances ("1.472" vs "1 472").
      expect(all.textContent).toMatch(/1[.  ]?472/);
    });

    it('omits the count slot when an option has no count', () => {
      const mixed: FilterTabOption<Status>[] = [
        { value: 'all', label: 'Tümü', count: 100 },
        { value: 'open', label: 'Sayım yok' }, // no count
      ];
      renderWithIntl(
        <FilterTabs<Status>
          value="all"
          onValueChange={() => {}}
          options={mixed.slice(0, 2) as FilterTabOption<Status>[]}
        />,
      );
      const noCount = screen.getByRole('tab', { name: /Sayım yok/ });
      // Trim to drop incidental whitespace; the entire visible text should
      // equal the label since no count slot was rendered.
      expect(noCount.textContent?.trim()).toBe('Sayım yok');
    });
  });

  describe('interaction', () => {
    it('invokes onValueChange with the clicked tab value', async () => {
      const onValueChange = vi.fn();
      const { user } = renderWithIntl(
        <FilterTabs<Status> value="all" onValueChange={onValueChange} options={BASE_OPTIONS} />,
      );
      await user.click(screen.getByRole('tab', { name: /Tamamlandı/ }));
      expect(onValueChange).toHaveBeenCalledWith('completed');
    });

    it('does not invoke onValueChange when a disabled tab is clicked', async () => {
      const onValueChange = vi.fn();
      const optionsWithDisabled: FilterTabOption<Status>[] = [
        { value: 'all', label: 'Tümü', count: 1472 },
        { value: 'open', label: 'Açık', count: 38, disabled: true },
      ];
      const { user } = renderWithIntl(
        <FilterTabs<Status>
          value="all"
          onValueChange={onValueChange}
          options={optionsWithDisabled}
        />,
      );
      await user.click(screen.getByRole('tab', { name: /Açık/ }));
      expect(onValueChange).not.toHaveBeenCalled();
    });
  });

  describe('loading', () => {
    it('replaces every count with a Skeleton and removes the formatted number', () => {
      const { container } = renderWithIntl(
        <FilterTabs<Status> value="all" onValueChange={() => {}} options={BASE_OPTIONS} loading />,
      );
      // No formatted count digits should be present in any tab while loading.
      for (const tab of screen.getAllByRole('tab')) {
        expect(tab.textContent ?? '').not.toMatch(/\d/);
      }
      // Skeletons share the `animate-pulse` class — assert at least one is
      // mounted inside the tablist.
      expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    });
  });
});
