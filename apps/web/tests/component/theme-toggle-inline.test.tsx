import { describe, expect, it } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from 'next-themes';

import { ThemeToggleInline } from '@/components/patterns/theme-toggle-inline';
import { render, screen } from '@/../tests/helpers/render';

const messages = {
  themeToggle: {
    label: 'Tema',
    light: 'Açık tema',
    dark: 'Koyu tema',
  },
};

function renderToggle() {
  return render(
    <NextIntlClientProvider locale="tr" messages={messages}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
        <ThemeToggleInline />
      </ThemeProvider>
    </NextIntlClientProvider>,
  );
}

describe('ThemeToggleInline', () => {
  it('renders both Sun and Moon icons in the DOM (CSS-only swap)', () => {
    renderToggle();
    expect(screen.getByTestId('theme-icon-sun')).toBeInTheDocument();
    expect(screen.getByTestId('theme-icon-moon')).toBeInTheDocument();
  });

  it('shows the localized Turkish label', () => {
    renderToggle();
    expect(screen.getByText('Tema')).toBeInTheDocument();
  });

  it('toggles state when the switch is clicked', async () => {
    const { user } = renderToggle();
    const switchEl = screen.getByRole('switch', { name: 'Tema' });
    expect(switchEl).toHaveAttribute('aria-checked', 'false');
    await user.click(switchEl);
    expect(switchEl).toHaveAttribute('aria-checked', 'true');
  });
});
