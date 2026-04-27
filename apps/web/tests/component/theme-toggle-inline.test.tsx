import { describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

import { ThemeToggleInline } from '@/components/patterns/theme-toggle-inline';
import {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar';
import { render, screen } from '@/../tests/helpers/render';

const messages = {
  themeToggle: {
    label: 'Tema',
    light: 'Açık tema',
    dark: 'Koyu tema',
  },
};

const setThemeMock = vi.fn();
let resolvedTheme = 'light';

vi.mock('@/providers/theme-provider', () => ({
  useTheme: () => ({
    theme: resolvedTheme,
    resolvedTheme,
    setTheme: (next: string) => {
      resolvedTheme = next;
      setThemeMock(next);
    },
  }),
}));

function renderToggle() {
  return render(
    <NextIntlClientProvider locale="tr" messages={messages}>
      <SidebarProvider defaultOpen>
        <Sidebar collapsible="icon">
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <ThemeToggleInline />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>
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
    // Multiple "Tema" copies exist (visible label span + sr-only tooltip
    // mirror), so use getAllByText and assert at least one is rendered.
    expect(screen.getAllByText('Tema').length).toBeGreaterThan(0);
  });

  it('calls setTheme when the row is clicked', async () => {
    setThemeMock.mockReset();
    resolvedTheme = 'light';
    const { user } = renderToggle();
    const button = screen.getByRole('button', { name: /tema/i });
    await user.click(button);
    expect(setThemeMock).toHaveBeenCalledWith('dark');
  });
});
