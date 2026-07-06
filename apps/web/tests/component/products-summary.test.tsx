import { describe, expect, it } from 'vitest';

import { ProductsSummary } from '@/features/products/components/products-summary';

import trMessages from '../../messages/tr.json';
import { render, screen } from '../helpers/render';

// Turkish copy is referenced through the message catalog (not inline literals)
// so this source file stays ASCII.
const summary = trMessages.products.summary;
const loadingLabel = trMessages.common.loading;

// Build the "Katalog payi: %N" context string from the catalog template so the
// expected copy tracks tr.json instead of a hardcoded literal.
const ofCatalog = (pct: number): string => summary.ofCatalog.replace('{pct}', String(pct));

describe('ProductsSummary', () => {
  it('renders each catalog-health label wired to its count and percent-of-catalog context', () => {
    render(<ProductsSummary counts={{ total: 100, missingCost: 25, missingVat: 10 }} />);

    // Labels present...
    expect(screen.getByText(summary.totalProducts)).toBeInTheDocument();
    expect(screen.getByText(summary.missingCost)).toBeInTheDocument();
    expect(screen.getByText(summary.missingVat)).toBeInTheDocument();

    // ...and the values render, so the label-to-number wiring is visible.
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();

    // The missing-data tiles carry the percent-of-catalog context (25 of 100 = 25%,
    // 10 of 100 = 10%) — the piece the bare tab counts don't show.
    expect(screen.getByText(ofCatalog(25))).toBeInTheDocument();
    expect(screen.getByText(ofCatalog(10))).toBeInTheDocument();
    // The total tile carries its own static context, not a catalog share.
    expect(screen.getByText(summary.totalContext)).toBeInTheDocument();
  });

  it('switches the context to the all-clear copy when nothing is missing', () => {
    render(<ProductsSummary counts={{ total: 100, missingCost: 0, missingVat: 0 }} />);

    // Both missing-cost and missing-vat tiles read the all-clear line.
    expect(screen.getAllByText(summary.noneMissing)).toHaveLength(2);
  });

  it('keeps the labels and exposes an accessible loading region while loading', () => {
    render(<ProductsSummary counts={undefined} />);

    expect(screen.getByText(summary.totalProducts)).toBeInTheDocument();
    expect(screen.getByText(summary.missingVat)).toBeInTheDocument();
    expect(screen.getByRole('status', { name: loadingLabel })).toBeInTheDocument();
  });
});
