import type * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

// The no-store variant links to the store settings through the locale-aware
// Link, which needs the Next router; a plain anchor stands in for it here.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { ProductsEmptyState } from '@/features/products/components/products-empty-state';

import trMessages from '../../../../messages/tr.json';
import { render, screen } from '../../../helpers/render';

// Turkish copy comes from the catalog so this file stays ASCII.
const empty = trMessages.products.empty;

describe('ProductsEmptyState', () => {
  it.each([
    ['missing-cost-none', empty.missingCostNone],
    ['missing-desi-none', empty.missingDesiNone],
  ] as const)('renders the all-clear copy for %s', (variant, title) => {
    render(<ProductsEmptyState variant={variant} />);
    expect(screen.getByText(title)).toBeInTheDocument();
  });
});
