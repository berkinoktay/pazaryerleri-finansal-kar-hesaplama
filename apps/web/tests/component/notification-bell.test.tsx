import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { NotificationBell } from '@/components/patterns/notification-bell';
import { render, screen } from '@/../tests/helpers/render';

const messages = {
  notificationBell: {
    label: 'Bildirimler',
    empty: 'Bildirim yok',
    seeAll: 'Tümünü gör',
  },
};

function renderBell(props: Partial<React.ComponentProps<typeof NotificationBell>> = {}) {
  return render(
    <NextIntlClientProvider locale="tr" messages={messages}>
      <NotificationBell entries={[]} unreadCount={0} {...props} />
    </NextIntlClientProvider>,
  );
}

describe('NotificationBell', () => {
  it('renders the trigger button with aria label', () => {
    renderBell();
    expect(screen.getByRole('button', { name: 'Bildirimler' })).toBeInTheDocument();
  });

  it('hides the count badge when unreadCount is 0', () => {
    renderBell({ unreadCount: 0 });
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('shows the count badge when unreadCount > 0', () => {
    renderBell({ unreadCount: 3 });
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('caps the count display at 9+', () => {
    renderBell({ unreadCount: 42 });
    expect(screen.getByText('9+')).toBeInTheDocument();
  });

  it('opens the popover with empty state when entries is empty', async () => {
    const { user } = renderBell({ entries: [], unreadCount: 0 });
    await user.click(screen.getByRole('button', { name: 'Bildirimler' }));
    expect(await screen.findByText('Bildirim yok')).toBeInTheDocument();
  });

  it('opens the popover and lists entries when present', async () => {
    const { user } = renderBell({
      entries: [
        { id: '1', icon: 'success', title: 'Sync tamam', timestamp: '3 dk' },
        { id: '2', icon: 'warning', title: '2 iade incele', timestamp: '15 dk' },
      ],
      unreadCount: 1,
    });
    await user.click(screen.getByRole('button', { name: 'Bildirimler' }));
    expect(await screen.findByText('Sync tamam')).toBeInTheDocument();
    expect(screen.getByText('2 iade incele')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tümünü gör' })).toHaveAttribute(
      'href',
      '/notifications',
    );
  });

  it('caps the visible entry list at 5 items', async () => {
    const entries = Array.from({ length: 7 }, (_, i) => ({
      id: String(i + 1),
      icon: 'info' as const,
      title: `Olay ${i + 1}`,
      timestamp: `${i + 1} dk`,
    }));
    const { user } = renderBell({ entries, unreadCount: 7 });
    await user.click(screen.getByRole('button', { name: 'Bildirimler' }));
    expect(await screen.findByText('Olay 1')).toBeInTheDocument();
    expect(screen.getByText('Olay 5')).toBeInTheDocument();
    expect(screen.queryByText('Olay 6')).not.toBeInTheDocument();
    expect(screen.queryByText('Olay 7')).not.toBeInTheDocument();
  });

  it('renders the source separator when entry has a source', async () => {
    const { user } = renderBell({
      entries: [
        { id: '1', icon: 'success', title: 'Sync tamam', timestamp: '3 dk', source: 'Trendyol' },
      ],
      unreadCount: 1,
    });
    await user.click(screen.getByRole('button', { name: 'Bildirimler' }));
    expect(await screen.findByText(/3 dk · Trendyol/)).toBeInTheDocument();
  });
});
