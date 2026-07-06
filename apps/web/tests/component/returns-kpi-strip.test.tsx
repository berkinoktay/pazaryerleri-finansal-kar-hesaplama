import { describe, expect, it } from 'vitest';

import type { ClaimsSummary } from '@/features/returns/api/get-claims-summary.api';
import { ReturnsKpiStrip } from '@/features/returns/components/returns-kpi-strip';

import trMessages from '../../messages/tr.json';
import { render, screen } from '../helpers/render';

// Turkish copy is referenced through the message catalog (not inline literals)
// so this source file stays ASCII.
const kpi = trMessages.returnsPage.kpi;
const loadingLabel = trMessages.common.loading;

const NEGATIVE_SUMMARY: ClaimsSummary = {
  openCount: 4,
  resolvedInPeriod: 7,
  refundDeductionGross: '785.50',
  commissionRefundGross: '120.00',
  costReturnGross: '194.20',
  netImpactGross: '-471.30',
};

const POSITIVE_SUMMARY: ClaimsSummary = {
  ...NEGATIVE_SUMMARY,
  netImpactGross: '120.00',
};

describe('ReturnsKpiStrip', () => {
  it('renders all four KPI labels from the summary', () => {
    render(<ReturnsKpiStrip summary={NEGATIVE_SUMMARY} loading={false} />);

    expect(screen.getByText(kpi.open)).toBeInTheDocument();
    expect(screen.getByText(kpi.resolvedInPeriod)).toBeInTheDocument();
    expect(screen.getByText(kpi.refundDeduction)).toBeInTheDocument();
    expect(screen.getByText(kpi.netImpact)).toBeInTheDocument();
  });

  it('tints a negative net impact destructive', () => {
    const { container } = render(<ReturnsKpiStrip summary={NEGATIVE_SUMMARY} loading={false} />);

    const destructive = container.querySelector('.text-destructive');
    expect(destructive).not.toBeNull();
    // The tint sits on the netImpact value node, not any other cell.
    expect(destructive).toHaveTextContent('471,30');
  });

  it('does not tint a positive net impact destructive', () => {
    const { container } = render(<ReturnsKpiStrip summary={POSITIVE_SUMMARY} loading={false} />);

    expect(container.querySelector('.text-destructive')).toBeNull();
  });

  it('keeps the labels and exposes an accessible loading region while loading', () => {
    render(<ReturnsKpiStrip summary={undefined} loading />);

    expect(screen.getByText(kpi.open)).toBeInTheDocument();
    expect(screen.getByText(kpi.netImpact)).toBeInTheDocument();
    expect(screen.getByRole('status', { name: loadingLabel })).toBeInTheDocument();
  });
});
