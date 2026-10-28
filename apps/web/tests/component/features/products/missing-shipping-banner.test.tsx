import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

// The banner links to the shipping settings through the locale-aware Link,
// which needs the Next.js router; a plain anchor is enough here.
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

import { MissingShippingBanner } from '@/features/products/components/missing-shipping-banner';

import trMessages from '../../../../messages/tr.json';
import { render, screen } from '../../../helpers/render';

const banner = trMessages.shipping.products.banner;

function withCount(template: string, count: number): string {
  return template.replace('{count}', String(count));
}

describe('MissingShippingBanner', () => {
  it('renders nothing when the page has nothing to report', () => {
    const { container } = render(
      <MissingShippingBanner counts={{ total: 0, noDesi: 0, noCarrier: 0, overflow: 0 }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('names the missing store shipping setup and links to the shipping settings', () => {
    render(<MissingShippingBanner counts={{ total: 28, noDesi: 0, noCarrier: 28, overflow: 0 }} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(banner.storeSetup.title);
    expect(alert).toHaveTextContent(banner.storeSetup.description);
    // A store-level setting affects every variant of the store, so the banner
    // does not present the page's count as if it were the whole store.
    expect(alert).not.toHaveTextContent('28');
    expect(screen.getByRole('link', { name: banner.storeSetup.cta })).toHaveAttribute(
      'href',
      expect.stringContaining('/settings/stores/shipping'),
    );
  });

  it('counts per-variant desi problems on this page and offers no action', () => {
    render(<MissingShippingBanner counts={{ total: 15, noDesi: 12, noCarrier: 0, overflow: 3 }} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(withCount(banner.title, 15));
    expect(alert).toHaveTextContent(withCount(banner.reasonNoDesi, 12));
    expect(alert).toHaveTextContent(withCount(banner.reasonOverflow, 3));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('lists only the reasons that actually occur (zero counts are noise)', () => {
    render(<MissingShippingBanner counts={{ total: 1, noDesi: 1, noCarrier: 0, overflow: 0 }} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(withCount(banner.reasonNoDesi, 1));
    expect(alert).not.toHaveTextContent(withCount(banner.reasonOverflow, 0));
  });
});
