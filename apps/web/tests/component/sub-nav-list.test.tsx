import { describe, expect, it, vi } from 'vitest';
import { type Messages, NextIntlClientProvider } from 'next-intl';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/orders',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/i18n/navigation', () => ({
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

import { SubNavList, type SubNavItem } from '@/components/patterns/sub-nav-list';
import { render, screen } from '@/../tests/helpers/render';

// Test-only mock messages tree. next-intl's `Messages` type is augmented
// from tr.json; using arbitrary keys requires casting the whole fixture.
const messages = {
  test: {
    section: { title: 'Durum' },
    all: 'Tümü',
    pending: 'Bekleyen',
    issues: 'Uyumsuz',
  },
} as unknown as Messages;

// labelKey is typed as a known message key; the test mocks a different
// schema, so cast through SubNavItem['labelKey'] for each fixture key.
type LabelKey = SubNavItem['labelKey'];

function renderList() {
  return render(
    <NextIntlClientProvider locale="tr" messages={messages}>
      <SubNavList
        headingKey={'test.section.title' as LabelKey}
        currentHref="/orders?status=pending"
        items={[
          { key: 'all', labelKey: 'test.all' as LabelKey, href: '/orders' },
          {
            key: 'pending',
            labelKey: 'test.pending' as LabelKey,
            href: '/orders?status=pending',
            count: 12,
          },
          {
            key: 'issues',
            labelKey: 'test.issues' as LabelKey,
            href: '/orders?status=issues',
            count: 3,
            tone: 'warning',
          },
        ]}
      />
    </NextIntlClientProvider>,
  );
}

describe('SubNavList', () => {
  it('renders the heading', () => {
    renderList();
    expect(screen.getByText('Durum')).toBeInTheDocument();
  });

  it('renders each item as a link', () => {
    renderList();
    expect(screen.getByRole('link', { name: /Tümü/ })).toHaveAttribute('href', '/orders');
    expect(screen.getByRole('link', { name: /Bekleyen/ })).toHaveAttribute(
      'href',
      '/orders?status=pending',
    );
  });

  it('renders count badges when provided', () => {
    renderList();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('marks the active item via aria-current', () => {
    renderList();
    const active = screen.getByRole('link', { name: /Bekleyen/ });
    expect(active).toHaveAttribute('aria-current', 'page');
  });

  it('applies a warning tone class to flagged items', () => {
    renderList();
    const issues = screen.getByText('3');
    expect(issues.className).toMatch(/warning/);
  });
});
