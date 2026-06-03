import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { HelpMenu } from '@/components/layout/help-menu';
import { HELP_MENU_ITEMS } from '@/components/layout/nav-config';
import { SidebarProvider } from '@/components/ui/sidebar';
import { render, screen } from '@/../tests/helpers/render';

const messages = {
  nav: {
    help: { label: 'Yardım & Destek' },
    whatsNew: 'Yenilikler',
    support: 'Destek',
  },
};

function renderHelp() {
  return render(
    <NextIntlClientProvider locale="tr" messages={messages}>
      <SidebarProvider>
        <HelpMenu items={HELP_MENU_ITEMS} />
      </SidebarProvider>
    </NextIntlClientProvider>,
  );
}

describe('HelpMenu', () => {
  it('renders the trigger with an accessible name (survives the collapsed rail)', () => {
    renderHelp();
    expect(screen.getByRole('button', { name: 'Yardım & Destek' })).toBeInTheDocument();
  });

  it('opens the menu and lists help destinations as links', async () => {
    const { user } = renderHelp();
    await user.click(screen.getByRole('button', { name: 'Yardım & Destek' }));

    expect(await screen.findByRole('link', { name: 'Yenilikler' })).toHaveAttribute(
      'href',
      '/whats-new',
    );
    expect(screen.getByRole('link', { name: 'Destek' })).toHaveAttribute('href', '/support');
  });
});
