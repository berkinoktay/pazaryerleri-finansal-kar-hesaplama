import { describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import { NuqsAdapter } from 'nuqs/adapters/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

import {
  PeriodPresetList,
  PERIOD_PRESETS,
} from '@/features/dashboard/components/period-preset-list';
import { render, screen } from '@/../tests/helpers/render';

const messages = {
  periodPresets: {
    heading: 'Dönem',
    'last-30d': 'Son 30 gün',
    'this-month': 'Bu ay',
    'last-7d': 'Son 7 gün',
    'this-quarter': 'Bu çeyrek',
    custom: 'Özel…',
  },
};

function renderList() {
  return render(
    <NuqsAdapter>
      <NextIntlClientProvider locale="tr" messages={messages}>
        <PeriodPresetList />
      </NextIntlClientProvider>
    </NuqsAdapter>,
  );
}

describe('PeriodPresetList', () => {
  it('renders all presets defined in PERIOD_PRESETS', () => {
    renderList();
    for (const preset of PERIOD_PRESETS) {
      expect(screen.getByText(messages.periodPresets[preset.key])).toBeInTheDocument();
    }
  });

  it('marks "last-30d" active when no period in URL (default)', () => {
    renderList();
    const active = screen.getByRole('button', { name: 'Son 30 gün' });
    expect(active).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches active preset on click', async () => {
    const { user } = renderList();
    await user.click(screen.getByRole('button', { name: 'Bu ay' }));
    expect(screen.getByRole('button', { name: 'Bu ay' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Son 30 gün' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});
