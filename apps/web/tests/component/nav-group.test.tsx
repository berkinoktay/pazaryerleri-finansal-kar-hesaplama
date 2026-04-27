import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/dashboard',
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [k: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { NavGroup } from '@/components/patterns/nav-group';
import {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar';
import { render, screen } from '@/../tests/helpers/render';

/**
 * NavGroup expects a SidebarProvider in the tree because it reads
 * collapsed state via `useSidebar()` to decide whether to render the
 * sub-items panel. Wrap every test render in a minimal sidebar shell.
 */
function renderInSidebar(ui: React.ReactElement) {
  return render(
    <SidebarProvider defaultOpen>
      <Sidebar collapsible="icon">
        <SidebarContent>
          <SidebarMenu>
            <SidebarMenuItem>{ui}</SidebarMenuItem>
          </SidebarMenu>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>,
  );
}

describe('NavGroup', () => {
  it('renders the parent route as a link with the configured href', () => {
    renderInSidebar(
      <NavGroup label="Karlılık Analizi" icon={<span aria-hidden>📈</span>} href="/karlilik">
        <button>Sipariş Karlılığı</button>
      </NavGroup>,
    );
    const link = screen.getByRole('link', { name: /karlılık analizi/i });
    expect(link).toHaveAttribute('href', '/karlilik');
  });

  it('default-collapses the sub-items via aria-expanded on the parent link', () => {
    renderInSidebar(
      <NavGroup label="Karlılık Analizi" icon={<span aria-hidden>📈</span>} href="/karlilik">
        <button>Sipariş Karlılığı</button>
      </NavGroup>,
    );
    const link = screen.getByRole('link', { name: /karlılık analizi/i });
    expect(link).toHaveAttribute('aria-expanded', 'false');
    // Sub-items remain in the DOM (the grid wrapper clips them to 0fr); we
    // assert presence rather than visibility because happy-dom does not
    // fully compute the overflow-hidden clip.
    expect(screen.getByText('Sipariş Karlılığı')).toBeInTheDocument();
  });

  it('toggles aria-expanded when the parent link is clicked', async () => {
    const { user } = renderInSidebar(
      <NavGroup label="Karlılık Analizi" icon={<span aria-hidden>📈</span>} href="/karlilik">
        <button>Sipariş Karlılığı</button>
      </NavGroup>,
    );
    const link = screen.getByRole('link', { name: /karlılık analizi/i });
    expect(link).toHaveAttribute('aria-expanded', 'false');
    await user.click(link);
    expect(link).toHaveAttribute('aria-expanded', 'true');
  });

  it('honors defaultExpanded so the parent link starts expanded', () => {
    renderInSidebar(
      <NavGroup
        label="Karlılık Analizi"
        icon={<span aria-hidden>📈</span>}
        href="/karlilik"
        defaultExpanded
      >
        <button>Sipariş Karlılığı</button>
      </NavGroup>,
    );
    const link = screen.getByRole('link', { name: /karlılık analizi/i });
    expect(link).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Sipariş Karlılığı')).toBeVisible();
  });

  it('renders the optional inline badge', () => {
    renderInSidebar(
      <NavGroup
        label="Karlılık Analizi"
        icon={<span aria-hidden>📈</span>}
        href="/karlilik"
        badge={{ variant: 'beta', label: 'Beta' }}
      >
        <button>Sipariş Karlılığı</button>
      </NavGroup>,
    );
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });
});
