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
  it('renders the total and missing-cost tiles with their counts', () => {
    render(<ProductsSummary counts={{ total: 100, missingCost: 25 }} />);

    expect(screen.getByText(summary.totalProducts)).toBeInTheDocument();
    expect(screen.getByText(summary.missingCost)).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    // The total tile carries its own static context, not a catalog share.
    expect(screen.getByText(summary.totalContext)).toBeInTheDocument();
  });

  it('shows exactly one catalog-share line: the missing-cost tile is the only missing-data tile', () => {
    render(<ProductsSummary counts={{ total: 100, missingCost: 25 }} />);

    expect(screen.getByText(ofCatalog(25))).toBeInTheDocument();
    expect(screen.getAllByText(isShareLine)).toHaveLength(1);
  });

  it('switches the missing-cost context to the all-clear copy when nothing is missing', () => {
    render(<ProductsSummary counts={{ total: 100, missingCost: 0 }} />);

    expect(screen.getByText(summary.noneMissing)).toBeInTheDocument();
    expect(screen.queryAllByText(isShareLine)).toHaveLength(0);
  });

  it('keeps the labels and exposes an accessible loading region while loading', () => {
    render(<ProductsSummary counts={undefined} />);

    expect(screen.getByText(summary.totalProducts)).toBeInTheDocument();
    expect(screen.getByText(summary.missingCost)).toBeInTheDocument();
    expect(screen.getByRole('status', { name: loadingLabel })).toBeInTheDocument();
  });
});
