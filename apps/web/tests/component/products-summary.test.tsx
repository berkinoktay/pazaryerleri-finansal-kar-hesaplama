import { describe, expect, it } from 'vitest';

import { ProductsSummary } from '@/features/products/components/products-summary';

import trMessages from '../../messages/tr.json';
import { render, screen } from '../helpers/render';

// Turkish copy is referenced through the message catalog (not inline literals)
// so this source file stays ASCII.
const summary = trMessages.products.summary;
const loadingLabel = trMessages.common.loading;

// The "share of catalog" context line, built from the catalog template.
const ofCatalog = (pct: number): string => summary.ofCatalog.replace('{pct}', String(pct));
const shareLinePrefix = summary.ofCatalog.slice(0, summary.ofCatalog.indexOf('{pct}'));

function isShareLine(content: string): boolean {
  return content.startsWith(shareLinePrefix);
}

describe('ProductsSummary', () => {
  it('renders the total, missing-cost and missing-desi tiles with their counts', () => {
    render(<ProductsSummary counts={{ total: 100, missingCost: 25, missingDesi: 10 }} />);

    expect(screen.getByText(summary.totalProducts)).toBeInTheDocument();
    expect(screen.getByText(summary.missingCost)).toBeInTheDocument();
    expect(screen.getByText(summary.missingDesi)).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    // The total tile carries its own static context, not a catalog share.
    expect(screen.getByText(summary.totalContext)).toBeInTheDocument();
  });

  it('gives each missing-data tile its own catalog-share line', () => {
    render(<ProductsSummary counts={{ total: 100, missingCost: 25, missingDesi: 10 }} />);

    expect(screen.getByText(ofCatalog(25))).toBeInTheDocument();
    expect(screen.getByText(ofCatalog(10))).toBeInTheDocument();
    expect(screen.getAllByText(isShareLine)).toHaveLength(2);
  });

  it('switches a tile to the all-clear copy when nothing is missing there', () => {
    render(<ProductsSummary counts={{ total: 100, missingCost: 25, missingDesi: 0 }} />);

    expect(screen.getByText(summary.noneMissing)).toBeInTheDocument();
    expect(screen.getAllByText(isShareLine)).toHaveLength(1);
    expect(screen.getByText(ofCatalog(25))).toBeInTheDocument();
  });

  it('shows the all-clear copy on both missing-data tiles when nothing is missing at all', () => {
    render(<ProductsSummary counts={{ total: 100, missingCost: 0, missingDesi: 0 }} />);

    expect(screen.getAllByText(summary.noneMissing)).toHaveLength(2);
    expect(screen.queryAllByText(isShareLine)).toHaveLength(0);
  });

  it('keeps the labels and exposes an accessible loading region while loading', () => {
    render(<ProductsSummary counts={undefined} />);

    expect(screen.getByText(summary.totalProducts)).toBeInTheDocument();
    expect(screen.getByText(summary.missingCost)).toBeInTheDocument();
    expect(screen.getByText(summary.missingDesi)).toBeInTheDocument();
    expect(screen.getByRole('status', { name: loadingLabel })).toBeInTheDocument();
  });
});
